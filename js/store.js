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
      s.sessions = s.sessions || [];
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
    snapshot() {
      this._undo.push(JSON.stringify({ chapters: this.state.chapters, log: this.state.log }));
      if (this._undo.length > 40) this._undo.shift();
      this._redo.length = 0;
    },
    undo() {
      if (!this._undo.length) return false;
      this._redo.push(JSON.stringify({ chapters: this.state.chapters, log: this.state.log }));
      const prev = JSON.parse(this._undo.pop());
      this.state.chapters = prev.chapters;
      this.state.log = prev.log;
      this.persist(); this.emit();
      return true;
    },
    redo() {
      if (!this._redo.length) return false;
      this._undo.push(JSON.stringify({ chapters: this.state.chapters, log: this.state.log }));
      const next = JSON.parse(this._redo.pop());
      this.state.chapters = next.chapters;
      this.state.log = next.log;
      this.persist(); this.emit();
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
      this.persist(); this.emit();
    },

    setEstimate(id, book, pomos) {
      const ch = this.chapter(id); if (!ch || !ch.books[book]) return;
      this.snapshot();
      ch.books[book].e = Math.max(0, Math.min(99, Math.round(pomos) || 0));
      ch.books[book].t = now();
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
        name: data.name.trim(), w: data.w || 1,
        seq: 999, extra: true, books, School: 'NYS', Coaching: 'NYS',
        t: now(), tS: now(), tC: now(), note: ''
      };
      this.state.chapters.push(ch);
      this.persist(); this.emit();
      return ch;
    },

    renameChapter(id, name) {
      const ch = this.chapter(id); if (!ch) return;
      this.snapshot(); ch.name = name.trim(); ch.t = now();
      this.persist(); this.emit();
    },

    removeChapter(id) {
      const ch = this.chapter(id);
      if (!ch) return null;
      this.snapshot();
      ch.del = true; ch.dt = now(); ch.t = now();
      this.persist(); this.emit();
      return ch;
    },

    /* ---------- effort log ---------- */
    logPomodoro(chapterId, book, minutes) {
      const d = today();
      this.state.log[d] = (this.state.log[d] || 0) + 1;
      this.state.logT[d] = now();
      this.state.sessions.push({ at: new Date().toISOString(), chapterId: chapterId || null, book: book || null, minutes });
      if (this.state.sessions.length > 800) this.state.sessions = this.state.sessions.slice(-800);
      this.persist(true); this.emit();
    },
    /* The -1 button. Removes one unit from today and drops the session
       that created it, so the ledger and the log never drift apart. */
    unlogPomodoro() {
      const d = today();
      if (!(this.state.log[d] > 0)) return false;
      this.state.log[d] -= 1;
      this.state.logT[d] = now();
      if (!this.state.log[d]) delete this.state.log[d];
      for (let i = this.state.sessions.length - 1; i >= 0; i--) {
        if (this.state.sessions[i].at.slice(0, 10) === new Date().toISOString().slice(0, 10)
            || new Date(this.state.sessions[i].at).toLocaleDateString('en-CA') === d) {
          this.state.sessions.splice(i, 1);
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
    loggedOn(dateStr) { return this.state.log[dateStr] || 0; },
    loggedToday() { return this.loggedOn(today()); },

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
      this.persist(true); this.emit();
    },

    /* ---------- backup ---------- */
    exportJSON() { return JSON.stringify(this.state, null, 2); },

    importJSON(text) {
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.chapters)) {
        throw new Error('That file has no chapters array — it is not a Syllabus OS backup.');
      }
      this.snapshot();
      this.state = this.migrate(parsed);
      this.persist(true); this.emit();
      return this.state.chapters.length;
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
        else if (h === 'school') idx.School = i;
        else if (h === 'coaching') idx.Coaching = i;
        else {
          const book = C.BOOK_KEYS.find(b => norm(b) === h);
          if (book) (idx.books || (idx.books = {}))[book] = i;
        }
      });
      if (idx.name == null) throw new Error('No "Chapter Name" column found in that paste.');

      this.snapshot();
      const mine = this.state.chapters.filter(c => c.subject === subject);
      let updated = 0, added = 0;

      rows.slice(1).forEach(r => {
        const name = String(r[idx.name] || '').trim();
        if (!name) return;
        const cls = idx.cls != null ? parseInt(r[idx.cls], 10) : null;

        let ch = mine.find(c => !c.del && norm(c.name) === norm(name) && (cls == null || c.cls === cls));
        if (!ch) {
          ch = this.addChapterQuiet({ subject, cls: cls || 11, name, w: 1 });
          mine.push(ch); added++;
        } else updated++;

        C.COVERAGE.forEach(col => {
          if (idx[col] == null) return;
          const v = OS.readStatus(r[idx[col]]);
          if (v) { ch[col] = v; ch[col === 'School' ? 'tS' : 'tC'] = now(); }
        });
        Object.entries(idx.books || {}).forEach(([book, i]) => {
          if (!ch.books[book]) return;
          const v = OS.readStatus(r[i]);
          if (v) { ch.books[book].s = v; ch.books[book].t = now(); }
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
        name: String(data.name).trim(), w: data.w || 1,
        seq: 999, extra: true, books, School: 'NYS', Coaching: 'NYS',
        t: now(), tS: now(), tC: now(), note: ''
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
      this.snapshot();
      const keepPin = this.state.settings.pin;
      const keepSet = this.state.settings.pinSet;
      this.state = freshState();
      this.state.settings.pin = keepPin;
      this.state.settings.pinSet = keepSet;
      this.state.settings.activeTarget = this.state.settings.targets[0].id;
      this.persist(true); this.emit();
    },

    resetProgressOnly() {
      this.snapshot();
      this.state.chapters.forEach(ch => {
        Object.values(ch.books).forEach(cell => { cell.s = 'NYS'; cell.t = now(); });
        ch.School = 'NYS'; ch.Coaching = 'NYS'; ch.tS = now(); ch.tC = now();
      });
      this.persist(true); this.emit();
    }
  };

  OS.Store = Store;
  OS.parseTable = parseTable;
  OS.today = today;
  OS.uid = uid;
})();
