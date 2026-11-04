/* ============================================================
   store.js — the only thing that touches localStorage.
   Everything else asks the store. Writes are debounced and
   every mutation pushes an undo snapshot.
   ============================================================ */
window.OS = window.OS || {};

(function () {
  const C = OS.CONFIG;

  /* ---------- helpers ---------- */
  const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
  const uid = p => (p || 'x') + Math.random().toString(36).slice(2, 8);

  /* A deliberately simple digest. This keeps a shoulder-surfer or a
     sibling out; it is not encryption and the data is readable in
     devtools by anyone who looks. Say so in the UI, don't pretend. */
  function digest(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  const norm = v => String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]/g, '');

  /* "11", "XI", "Class 11", "xii" -> 11 / 12. Anything else -> null, so a
     stray value never creates a duplicate chapter under a wrong class. */
  function readClass(v) {
    const n = norm(v).replace(/^class/, '');
    if (n === '11' || n === 'xi') return 11;
    if (n === '12' || n === 'xii') return 12;
    return null;
  }
  function readSubject(v) {
    const n = norm(v);
    if (n.startsWith('phy')) return 'Physics';
    if (n.startsWith('chem')) return 'Chemistry';
    if (n.startsWith('math')) return 'Maths';
    return null;
  }

  /* Tab-separated (a Sheets copy-paste) or comma-separated (a CSV
     download). Sniff whichever delimiter the header row uses more. */
  function parseTable(text) {
    const raw = String(text).replace(/\r\n?/g, '\n').trim();
    if (!raw) return [];
    const firstLine = raw.split('\n')[0];
    const delim = (firstLine.split('\t').length > firstLine.split(',').length) ? '\t' : ',';

    const rows = [[]]; let cell = '', quoted = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (quoted) {
        if (ch === '"') { if (raw[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delim) { rows[rows.length - 1].push(cell); cell = ''; }
      else if (ch === '\n') { rows[rows.length - 1].push(cell); cell = ''; rows.push([]); }
      else cell += ch;
    }
    rows[rows.length - 1].push(cell);
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
  }

  function freshState() {
    const d = new Date();
    const janTarget = new Date(d.getFullYear() + (d.getMonth() > 5 ? 1 : 0), 0, 24);
    return {
      schema: C.SCHEMA,
      epoch: 0,       // bumped by reset/restore so they win over stale copies
      chapters: OS.buildSeedChapters(),
      settings: {
        pin: digest('1234'),
        pinSet: false,
        minutes: C.DEFAULT_MINUTES,
        breakMinutes: C.DEFAULT_BREAK,
        capacity: C.DEFAULT_CAPACITY,
        theme: 'auto',
        /* Which books count towards the debt right now. */
        books: Object.fromEntries(C.BOOKS.map(b => [b.key, !!b.on])),
        targets: [
          { id: uid('t'), label: 'JEE Main — Session 1', date: janTarget.toLocaleDateString('en-CA') }
        ],
        activeTarget: null,
        st: 0
      },
      log: {},        // { 'YYYY-MM-DD': pomodoroCount }
      logT: {},       // { 'YYYY-MM-DD': lastTouchedMs }  -- drives log merging
      sessions: [],   // { at, chapterId, book, minutes }
      meta: { created: new Date().toISOString(), updated: new Date().toISOString() }
    };
  }

  /* ---------- the store ---------- */
  const now = () => Date.now();

  /* Who is sitting at this browser. Deliberately NOT part of the synced
     document — it is a property of the device, not the board, so each
     person keeps their own name and it never merges away. */
  const WHO_KEY = 'burning-sun/who';
  let whoCache = null;
  function who() {
    if (whoCache !== null) return whoCache;
    try { whoCache = localStorage.getItem(WHO_KEY) || ''; }
    catch (e) { whoCache = ''; }
    return whoCache;
  }
  function setWho(name) {
    whoCache = String(name || '').trim().slice(0, 24);
    try { localStorage.setItem(WHO_KEY, whoCache); } catch (e) {}
  }

  /* Put `target` chapters back, stamping every field that changes
     relative to `current` with the time and the person who did it. */
  function restamp(current, target) {
    const t = now(), by = who();
    const cur = new Map(current.map(c => [c.id, c]));
    const out = target.map(ch => {
      const was = cur.get(ch.id);
      cur.delete(ch.id);
      if (!was) { ch.t = t; ch.by = by; return ch; }
      Object.keys(ch.books || {}).forEach(k => {
        const a = ch.books[k], b = (was.books || {})[k];
        if (!b || a.s !== b.s || a.e !== b.e) { a.t = t; a.by = by; }
      });
      if (ch.School !== was.School) { ch.tS = t; ch.bS = by; }
      if (ch.Coaching !== was.Coaching) { ch.tC = t; ch.bC = by; }
      if (!!ch.del !== !!was.del) { ch.dt = t; }
      if (ch.name !== was.name || ch.w !== was.w || !!ch.del !== !!was.del) { ch.t = t; ch.by = by; }
      return ch;
    });
    /* Chapters added after the snapshot are removed — as tombstones, so
       the removal also reaches other devices. */
    cur.forEach(ch => {
      if (ch.del) { out.push(ch); return; }
      out.push(Object.assign({}, ch, { del: true, dt: t, t, by }));
    });
    return out;
  }

  const Store = {
    state: null,
    unlocked: false,
    _undo: [],
    _redo: [],
    _timer: null,
    _subs: [],

    load() {
      let raw = null;
      try { raw = localStorage.getItem(C.STORE_KEY); }
      catch (e) { OS.storageBlocked = true; }

      if (!raw) {
        this.state = freshState();
        if (!this.state.settings.activeTarget) {
          this.state.settings.activeTarget = this.state.settings.targets[0].id;
        }
        this.persist(true);
        this.fresh = true;
        return this.state;
      }
      try {
        const parsed = JSON.parse(raw);
        this.state = this.migrate(parsed);
      } catch (e) {
        console.warn('Saved data was unreadable — starting a clean file.', e);
        /* Never throw away what was there: park the raw text under its own
           key so it can be recovered from devtools or a backup tool. */
        try { localStorage.setItem(C.STORE_KEY + '/unreadable-' + Date.now(), raw); } catch (e2) {}
        this.state = freshState();
        this.state.settings.activeTarget = this.state.settings.targets[0].id;
        this.corrupt = true;
      }
      return this.state;
    },

    /* Forward-compatible: fills in anything a newer build expects. */
    migrate(s) {
      const base = freshState();
      s.schema = C.SCHEMA;
      s.settings = Object.assign({}, base.settings, s.settings || {});
      s.log = s.log || {};
      s.logT = s.logT || {};
      s.epoch = typeof s.epoch === 'number' ? s.epoch : 0;
      s.sessions = Array.isArray(s.sessions) ? s.sessions.filter(x => x && x.at) : [];
      s.meta = Object.assign({}, base.meta, s.meta || {});
      s.chapters = Array.isArray(s.chapters) && s.chapters.length ? s.chapters : base.chapters;

      s.chapters.forEach(ch => {
        ch.id = ch.id || uid('c');
        ch.books = ch.books || {};
        ch.t = ch.t || 0; ch.tS = ch.tS || 0; ch.tC = ch.tC || 0;
        ch.w = typeof ch.w === 'number' ? ch.w : 1;
        ch.School = ch.School || 'NYS';
        ch.Coaching = ch.Coaching || 'NYS';
        C.BOOKS.forEach(b => {
          if (!OS.bookApplies(b.key, ch.subject)) { delete ch.books[b.key]; return; }
          const cell = ch.books[b.key];
          if (!cell) {
            ch.books[b.key] = { s: 'NYS', e: Math.max(C.POMO_MIN, Math.round(C.POMO_BASE * ch.w * b.mult)), t: 0 };
          } else {
            if (!C.STATUS_BY_KEY[cell.s]) cell.s = 'NYS';
            if (!(cell.e > 0)) cell.e = Math.max(C.POMO_MIN, Math.round(C.POMO_BASE * ch.w * b.mult));
            cell.t = cell.t || 0;
          }
        });
      });

      /* A book added in a later version defaults to its shipped state
         rather than vanishing from the settings panel. */
      s.settings.books = Object.assign({}, base.settings.books, s.settings.books || {});
      Object.keys(s.settings.books).forEach(k => {
        if (!C.BOOK_BY_KEY[k]) delete s.settings.books[k];
      });

      if (!s.settings.targets.length) s.settings.targets = base.settings.targets;
      if (!s.settings.targets.some(t => t.id === s.settings.activeTarget)) {
        s.settings.activeTarget = s.settings.targets[0].id;
      }
      return s;
    },

    persist(immediate) {
      this.state.meta.updated = new Date().toISOString();
      clearTimeout(this._timer);
      const write = () => {
        try {
          localStorage.setItem(C.STORE_KEY, JSON.stringify(this.state));
          OS.storageBlocked = false;
        } catch (e) {
          OS.storageBlocked = true;
          OS.toast && OS.toast('Nothing saved — this browser is blocking storage', 'bad');
        }
      };
      if (immediate) write(); else this._timer = setTimeout(write, 260);
    },

    /* ---------- undo ---------- */
    /* Two kinds of undo step:
         - chapter edits (the default) keep only the chapters. Pomodoros are
           never part of it, so Ctrl+Z cannot wipe logged effort.
         - whole-board steps (reset, restore a backup) keep everything.
       Restoring is itself a new change, so it is re-stamped "now";
       otherwise the next sync would merge the undone values back in. */
    _frame(full) {
      return JSON.stringify(full
        ? { full: true, state: this.state }
        : { full: false, chapters: this.state.chapters });
    },
    snapshot(full) {
      this._undo.push(this._frame(full));
      if (this._undo.length > 40) this._undo.shift();
      this._redo.length = 0;
    },
    _restore(frameText, otherStack) {
      const frame = JSON.parse(frameText);
      otherStack.push(this._frame(frame.full));
      if (frame.full) {
        this.state = this.migrate(frame.state);
        this.state.epoch = now();
      } else {
        this.state.chapters = restamp(this.state.chapters, frame.chapters);
      }
      this.persist(); this.emit();
    },
    undo() {
      if (!this._undo.length) return false;
      this._restore(this._undo.pop(), this._redo);
      return true;
    },
    redo() {
      if (!this._redo.length) return false;
      this._restore(this._redo.pop(), this._undo);
      return true;
    },
    get canUndo() { return this._undo.length > 0; },

    /* ---------- pub/sub ---------- */
    on(fn) { this._subs.push(fn); },
    emit() { this._subs.forEach(fn => fn()); },

    /* ---------- chapter mutations ---------- */
    chapter(id) { return this.state.chapters.find(c => c.id === id); },

    /* Deleted chapters stay as tombstones so the delete can reach other
       devices. Everything that draws or counts uses this instead. */
    live() { return this.state.chapters.filter(c => !c.del); },

    setStatus(id, book, status) {
      const ch = this.chapter(id); if (!ch || !ch.books[book]) return;
      this.snapshot();
      ch.books[book].s = status;
      ch.books[book].t = now();
      ch.books[book].by = who();
      this.persist(); this.emit();
    },

    cycleStatus(id, book, backwards) {
      const ch = this.chapter(id); if (!ch || !ch.books[book]) return null;
      const keys = C.STATUS_KEYS;
      const i = keys.indexOf(ch.books[book].s);
      const next = keys[(i + (backwards ? -1 : 1) + keys.length) % keys.length];
      this.setStatus(id, book, next);
      return next;
    },

    setCoverage(id, col, status) {
      const ch = this.chapter(id); if (!ch) return;
      this.snapshot();
      ch[col] = status;
      ch[col === 'School' ? 'tS' : 'tC'] = now();
      ch[col === 'School' ? 'bS' : 'bC'] = who();
      this.persist(); this.emit();
    },

    setEstimate(id, book, pomos) {
      const ch = this.chapter(id); if (!ch || !ch.books[book]) return;
      this.snapshot();
      ch.books[book].e = Math.max(0, Math.min(99, Math.round(pomos) || 0));
      ch.books[book].t = now();
      ch.books[book].by = who();
      this.persist(); this.emit();
    },

    addChapter(data) {
      this.snapshot();
      const books = {};
      C.BOOKS.forEach(b => {
        if (!OS.bookApplies(b.key, data.subject)) return;
        books[b.key] = { s: 'NYS', e: Math.max(C.POMO_MIN, Math.round(C.POMO_BASE * (data.w || 1) * b.mult)), t: now() };
      });
      const ch = {
        id: uid('c'), subject: data.subject, cls: +data.cls,
        name: data.name.trim().slice(0, 120), w: Math.min(3, Math.max(0.2, +data.w || 1)),
        seq: 999, extra: true, books, School: 'NYS', Coaching: 'NYS',
        t: now(), tS: now(), tC: now(), by: who(), bS: who(), bC: who(),
        added: now(), note: ''
      };
      this.state.chapters.push(ch);
      this.persist(); this.emit();
      return ch;
    },

    renameChapter(id, name) {
      const ch = this.chapter(id); if (!ch) return;
      this.snapshot(); ch.name = name.trim().slice(0, 120); ch.t = now(); ch.by = who();
      this.persist(); this.emit();
    },

    removeChapter(id) {
      const ch = this.chapter(id);
      if (!ch) return null;
      this.snapshot();
      ch.del = true; ch.dt = now(); ch.t = now(); ch.by = who();
      this.persist(); this.emit();
      return ch;
    },

    /* ---------- effort log ---------- */
    /* `endedAt` is when the focus block actually finished, which can be
       earlier than now if the phone was locked when it ran out. */
    logPomodoro(chapterId, book, minutes, endedAt) {
      const end = endedAt && endedAt <= now() ? endedAt : now();
      const d = new Date(end).toLocaleDateString('en-CA');
      this.state.log[d] = (this.state.log[d] || 0) + 1;
      this.state.logT[d] = now();
      this.state.sessions.push({
        at: new Date(end).toISOString(), ms: end, by: who(),
        chapterId: chapterId || null, book: book || null, minutes
      });
      if (this.state.sessions.length > 800) this.state.sessions = this.state.sessions.slice(-800);
      this.persist(true); this.emit();
    },
    /* The -1 button. Removes one unit from today and drops the session
       that created it, so the ledger and the log never drift apart. */
    unlogPomodoro() {
      const d = today();
      if (!(this.state.log[d] > 0)) return false;
      this.state.log[d] -= 1;
      this.state.logT[d] = now();          // kept even at zero: it carries the removal
      if (!this.state.log[d]) delete this.state.log[d];
      /* Mark (not delete) today's latest session, matching on the LOCAL
         date — an ISO string is UTC, which is yesterday before 05:30 IST. */
      for (let i = this.state.sessions.length - 1; i >= 0; i--) {
        const x = this.state.sessions[i];
        if (x.x) continue;
        if (new Date(x.ms || x.at).toLocaleDateString('en-CA') === d) {
          this.state.sessions[i] = Object.assign({}, x, { x: true, xt: now() });
          break;
        }
      }
      this.persist(true); this.emit();
      return true;
    },
    adjustToday(delta) {
      const d = today();
      this.state.log[d] = Math.max(0, (this.state.log[d] || 0) + delta);
      this.state.logT[d] = now();
      if (!this.state.log[d]) delete this.state.log[d];
      this.persist(); this.emit();
    },
    /* Sessions that still count (removed ones are kept as markers). */
    sessionsLive() { return (this.state.sessions || []).filter(x => !x.x); },
    loggedOn(dateStr) { return this.state.log[dateStr] || 0; },
    loggedToday() { return this.loggedOn(today()); },

    who, setWho,

    /* Everyone who has touched this board, most recently first. */
    people() {
      const seen = new Map();
      const note = (name, ms) => {
        if (!name || !ms) return;
        if (!seen.has(name) || seen.get(name) < ms) seen.set(name, ms);
      };
      this.state.chapters.forEach(ch => {
        Object.values(ch.books).forEach(c => note(c.by, c.t));
        note(ch.bS, ch.tS); note(ch.bC, ch.tC); note(ch.by, ch.t);
      });
      this.sessionsLive().forEach(x => note(x.by, x.ms || Date.parse(x.at)));
      return [...seen.entries()]
        .map(([name, last]) => ({ name, last }))
        .sort((a, b) => b.last - a.last);
    },

    /* ---------- settings ---------- */
    set(path, value) {
      this.state.settings[path] = value;
      if (path !== 'st') this.state.settings.st = now();
      this.persist(); this.emit();
    },
    addTarget(label, date) {
      const t = { id: uid('t'), label: label.trim(), date };
      this.state.settings.targets.push(t);
      this.state.settings.activeTarget = t.id;
      this.state.settings.st = now();
      this.persist(); this.emit();
      return t;
    },
    removeTarget(id) {
      const s = this.state.settings;
      s.targets = s.targets.filter(t => t.id !== id);
      if (s.activeTarget === id) s.activeTarget = s.targets[0]?.id || null;
      s.st = now();
      this.persist(); this.emit();
    },
    activeTarget() {
      const s = this.state.settings;
      return s.targets.find(t => t.id === s.activeTarget) || s.targets[0] || null;
    },

    /* Park or restore a book. The marks are never touched, so this is
       always reversible. */
    setBookOn(key, on) {
      const books = Object.assign({}, this.state.settings.books);
      books[key] = !!on;
      this.set('books', books);
    },

    /* ---------- PIN ---------- */
    checkPin(pin) { return digest(String(pin)) === this.state.settings.pin; },
    setPin(pin) {
      this.state.settings.pin = digest(String(pin));
      this.state.settings.pinSet = true;
      this.state.settings.st = now();
      this.persist(true); this.emit();
    },

    /* ---------- backup ---------- */
    exportJSON() { return JSON.stringify(this.state, null, 2); },

    /* The chapter sheet as CSV, in the same column layout the sheet
       importer reads, so it round-trips through Google Sheets. */
    exportCSV() {
      const q = v => {
        const t = String(v == null ? '' : v);
        return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
      };
      const head = ['Subject', 'Class', 'Chapter Name', ...C.COVERAGE, ...C.BOOK_KEYS];
      const order = s => C.SUBJECT_ORDER.indexOf(s);
      const rows = this.live().slice().sort((a, b) =>
        order(a.subject) - order(b.subject) || a.cls - b.cls || a.seq - b.seq);
      return [head, ...rows.map(ch => [
        ch.subject, ch.cls, ch.name, ch.School, ch.Coaching,
        ...C.BOOK_KEYS.map(k => ch.books[k] ? ch.books[k].s : '')
      ])].map(r => r.map(q).join(',')).join('\n');
    },

    importJSON(text) {
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.chapters)) {
        throw new Error('That file has no chapters array — it is not a Syllabus OS backup.');
      }
      this.snapshot(true);
      this.state = this.migrate(parsed);
      this.state.epoch = now();            // a restore replaces the board everywhere
      this.persist(true); this.emit();
      return this.live().length;
    },

    /* ---------- import a pasted sheet tab ----------
       Accepts what you get from selecting cells in Google Sheets and
       hitting copy (tab separated), or a downloaded CSV. Matches rows
       to existing chapters by name + class, adds anything new. */
    importSheetText(text, subject) {
      const rows = parseTable(text);
      if (rows.length < 2) throw new Error('Needs a header row and at least one chapter row.');

      const head = rows[0].map(h => norm(h));
      const idx = {};
      head.forEach((h, i) => {
        if (h === 'chaptername' || h === 'chapter' || h === 'name') idx.name = i;
        else if (h === 'class' || h === 'cls') idx.cls = i;
        else if (h === 'subject') idx.subject = i;
        else if (h === 'school') idx.School = i;
        else if (h === 'coaching') idx.Coaching = i;
        else {
          const book = C.BOOK_KEYS.find(b => norm(b) === h);
          if (book) (idx.books || (idx.books = {}))[book] = i;
        }
      });
      if (idx.name == null) throw new Error('No "Chapter Name" column found in that paste.');

      this.snapshot();
      let updated = 0, added = 0;
      const by = who();

      rows.slice(1).forEach(r => {
        const name = String(r[idx.name] || '').trim().slice(0, 120);
        if (!name) return;
        const cls = idx.cls != null ? readClass(r[idx.cls]) : null;
        /* A Subject column (as in our own CSV export) overrides the picker. */
        const rowSub = idx.subject != null ? readSubject(r[idx.subject]) : null;
        const sub = rowSub || subject;

        let ch = this.state.chapters.find(c => !c.del && c.subject === sub &&
          norm(c.name) === norm(name) && (cls == null || c.cls === cls));
        if (!ch) {
          ch = this.addChapterQuiet({ subject: sub, cls: cls || 11, name, w: 1 });
          added++;
        } else updated++;

        C.COVERAGE.forEach(col => {
          if (idx[col] == null) return;
          const v = OS.readStatus(r[idx[col]]);
          if (v && v !== ch[col]) {
            ch[col] = v;
            ch[col === 'School' ? 'tS' : 'tC'] = now();
            ch[col === 'School' ? 'bS' : 'bC'] = by;
          }
        });
        Object.entries(idx.books || {}).forEach(([book, i]) => {
          if (!ch.books[book]) return;
          const v = OS.readStatus(r[i]);
          if (v && v !== ch.books[book].s) { ch.books[book].s = v; ch.books[book].t = now(); ch.books[book].by = by; }
        });
      });

      this.persist(true); this.emit();
      return { updated, added };
    },

    /* addChapter without its own undo snapshot, for bulk import. */
    addChapterQuiet(data) {
      const books = {};
      C.BOOKS.forEach(b => {
        if (!OS.bookApplies(b.key, data.subject)) return;
        books[b.key] = { s: 'NYS', e: Math.max(C.POMO_MIN, Math.round(C.POMO_BASE * (data.w || 1) * b.mult)), t: now() };
      });
      const ch = {
        id: uid('c'), subject: data.subject, cls: +data.cls,
        name: String(data.name).trim().slice(0, 120), w: data.w || 1,
        seq: 999, extra: true, books, School: 'NYS', Coaching: 'NYS',
        t: now(), tS: now(), tC: now(), by: who(), note: ''
      };
      this.state.chapters.push(ch);
      return ch;
    },

    /* Replace local state with a merged document from the server. */
    adopt(doc) {
      this.state = this.migrate(doc);
      this.persist(true);
      this.emit();
    },

    resetAll() {
      this.snapshot(true);
      const keepPin = this.state.settings.pin;
      const keepSet = this.state.settings.pinSet;
      this.state = freshState();
      this.state.settings.pin = keepPin;
      this.state.settings.pinSet = keepSet;
      this.state.settings.activeTarget = this.state.settings.targets[0].id;
      this.state.settings.st = now();
      this.state.epoch = now();            // a reset replaces the board everywhere
      this.persist(true); this.emit();
    },

    resetProgressOnly() {
      this.snapshot();
      this.state.chapters.forEach(ch => {
        const by = who();
        Object.values(ch.books).forEach(cell => { cell.s = 'NYS'; cell.t = now(); cell.by = by; });
        ch.School = 'NYS'; ch.Coaching = 'NYS'; ch.tS = now(); ch.tC = now(); ch.bS = by; ch.bC = by;
      });
      this.persist(true); this.emit();
    }
  };

  OS.Store = Store;
  OS.parseTable = parseTable;
  OS.today = today;
  OS.uid = uid;
})();
