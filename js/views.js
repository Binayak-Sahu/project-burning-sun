/* ============================================================
   views.js — reads Store + Engine, writes the DOM.
   One render() drives everything; sub-renders stay pure-ish.
   ============================================================ */
window.OS = window.OS || {};

(function () {
  const { $, qs, qsa, esc, el, toast, pomo, hours, ago } = OS.ui;
  const C = OS.CONFIG;
  const E = OS.Engine;
  const S = OS.Store;

  /* ---------- view state (lives in the URL, not localStorage) ---------- */
  const V = {
    subject: 'All',
    cls: 'all',
    focus: null,        // status filter
    book: 'all',        // book filter
    query: '',
    sort: 'priority',
    hideUntaught: false,
    mode: 'marks',      // marks | estimates
    expanded: {}
  };
  OS.V = V;

  /* ---------- URL sync ---------- */
  function writeHash() {
    const p = new URLSearchParams();
    if (V.subject !== 'All') p.set('s', V.subject);
    if (V.cls !== 'all') p.set('c', V.cls);
    if (V.book !== 'all') p.set('b', V.book);
    if (V.focus) p.set('f', V.focus);
    if (V.query) p.set('q', V.query);
    if (V.sort !== 'priority') p.set('o', V.sort);
    if (V.hideUntaught) p.set('h', '1');
    history.replaceState(null, '', p.toString() ? '#' + p : location.pathname);
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    V.subject = p.get('s') || 'All';
    V.cls = p.get('c') || 'all';
    V.book = p.get('b') || 'all';
    V.focus = p.get('f') || null;
    V.query = (p.get('q') || '').toLowerCase();
    V.sort = p.get('o') || 'priority';
    V.hideUntaught = p.get('h') === '1';
    if (V.query && $('q')) $('q').value = V.query;
  }

  /* ---------- scoping ---------- */
  function activeBooks() {
    const live = OS.liveBooks(V.subject);
    if (V.book !== 'all' && live.includes(V.book)) return [V.book];
    if (V.book !== 'all') V.book = 'all';   // the pinned book was parked
    return live;
  }

  function inScope(ch) {
    if (V.subject !== 'All' && ch.subject !== V.subject) return false;
    if (V.cls !== 'all' && ch.cls !== +V.cls) return false;
    if (V.hideUntaught && ch.School !== 'Completed' && ch.Coaching !== 'Completed') return false;
    if (V.book !== 'all' && !ch.books[V.book]) return false;
    return true;
  }
  function scoped() { return S.live().filter(inScope); }
  function searched(list) {
    if (!V.query) return list;
    const q = V.query;
    return list.filter(ch => ch.name.toLowerCase().includes(q) || ch.subject.toLowerCase().includes(q));
  }

  /* ============================================================
     1. Countdown plate — days, debt, quota, verdict
     ============================================================ */
  function renderCountdown(rows, books) {
    const t = E.tally(rows, books);
    const p = E.pace(S, t.remaining);
    const streak = E.streak(S);
    OS.lastPace = p;              // the timer reads today's quota from here
    const host = $('countdown');

    const target = p.target;
    const daysTxt = p.days === null ? '—' : (p.days < 0 ? Math.abs(p.days) : p.days);
    const urgent = p.days !== null && p.days <= 45;

    const gauges = [
      {
        lbl: 'Study debt',
        fig: t.remaining.toLocaleString(),
        sub: hours(t.remaining, p.minutes) + ' of focus left',
        tone: ''
      },
      {
        lbl: 'Daily quota',
        fig: p.required === null ? '—' : p.required,
        sub: p.capacityGap === null
          ? (p.days === 0 ? 'exam day' : p.days !== null && p.days < 0 ? 'target has passed' : 'set a target date')
          : p.capacityGap > 0 ? '+' + p.capacityGap + ' over your ceiling'
          : Math.abs(p.capacityGap) + ' under your ceiling',
        tone: p.verdict === 'behind' ? 'bad' : p.verdict === 'tight' ? 'warn' : 'good'
      },
      {
        lbl: 'Today',
        fig: p.loggedToday + '/' + (p.required === null ? p.capacity : p.required),
        sub: p.todayLeft === null ? 'logged so far'
          : p.todayLeft === 0 ? 'quota met — anything more is banked'
          : p.todayLeft + ' to go',
        tone: p.todayLeft === 0 ? 'good' : ''
      },
      {
        lbl: 'Syllabus done',
        fig: t.pctDone + '%',
        sub: t.counts.Completed + ' of ' + t.cells + ' book-chapters',
        tone: ''
      }
    ];

    const verdictText = (() => {
      if (!target) return ['tight', 'No exam date set. <b>Add one</b> and the quota becomes real.'];
      if (p.days === 0) return ['tight', `<b>${esc(target.label)}</b> is today. No new chapters: read your mistake notes, eat, and go in rested.`];
      if (p.days !== null && p.days < 0) return ['behind', `<b>${target.label}</b> was ${Math.abs(p.days)} days ago. Point this at your next paper.`];
      if (t.remaining === 0) return ['ahead', `Syllabus clear for this view. <b>${target.label}</b> in ${p.days} days — switch to revision passes.`];
      if (p.verdict === 'behind') return ['behind', `At <b>${p.capacity}/day</b> you finish ${p.slipDays > 0 ? p.slipDays + ' days late' : 'short'}. Either raise the ceiling to <b>${p.required}</b> or cut scope.`];
      if (p.verdict === 'tight') return ['tight', `<b>${p.required}/day</b> against a ${p.capacity}/day ceiling. Doable, with no slack for a bad week.`];
      return ['ahead', `<b>${p.required}/day</b> clears it with room. Bank the surplus on doubts.`];
    })();

    host.innerHTML = `
      <div class="cd-left">
        <div class="cd-target">
          <span class="dot ${urgent ? 'bad' : ''}"></span>
          <span>${target ? esc(target.label) : 'No target set'}</span>
        </div>
        <div class="cd-days ${urgent ? 'urgent' : ''}">${daysTxt}</div>
        <div class="cd-unit">${p.days !== null && p.days < 0 ? 'days ago' : 'days left'}${target ? ' · ' + E.fmtDate(target.date) : ''}</div>
      </div>
      <div class="cd-right">
        ${gauges.map(g => `
          <div class="gauge ${g.tone}">
            <span class="lbl">${g.lbl}</span>
            <span class="fig">${g.fig}</span>
            <span class="sub">${g.sub}</span>
          </div>`).join('')}
      </div>
      <div class="verdict ${verdictText[0]}">
        <span class="tag">${verdictText[0] === 'ahead' ? 'On track' : verdictText[0] === 'tight' ? 'Tight' : 'Behind'}</span>
        <span>${verdictText[1]}</span>
        <span style="margin-left:auto" class="hint">${streak > 0 ? streak + '-day streak' : 'no streak yet'} · 7-day avg ${p.avg7}/day</span>
      </div>`;

    return { t, p };
  }

  /* ============================================================
     2. Book cards
     ============================================================ */
  function renderBookCards(rows, books, minutes) {
    const host = $('cards');
    host.innerHTML = '';
    const t = E.tally(rows, books);

    books.forEach(bk => {
      const b = C.BOOK_BY_KEY[bk];
      const d = t.perBook[bk];
      const card = el('div', { class: 'card bookcard hoverable' });

      if (!d || !d.cells) {
        card.innerHTML = `<h2>${esc(bk)}</h2><div class="of">${esc(b.note)}</div>
          <p class="na">Nothing in this view.</p>`;
        host.appendChild(card); return;
      }

      const pct = d.estTotal ? Math.round((1 - d.remaining / d.estTotal) * 100) : 0;
      const segs = C.DISPLAY_ORDER.map(s =>
        `<div class="seg ${s.cls}" style="width:${(d.counts[s.key] / d.cells * 100).toFixed(2)}%"></div>`).join('');
      const list = C.DISPLAY_ORDER.map(s =>
        `<div class="row"><span class="b ${s.cls}"></span><span class="lbl">${s.label}</span><span class="val">${d.counts[s.key]}</span></div>`).join('');

      card.innerHTML = `
        <h2>${esc(bk)}</h2>
        <div class="of">${esc(b.note)} · ${d.cells} chapters</div>
        <div class="headline"><span class="num">${pct}<span style="font-size:16px">%</span></span><span class="pct">closed out</span></div>
        <div class="debt"><b>${pomo(d.remaining)}</b> left · ${hours(d.remaining, minutes)}</div>
        <div class="scale"><div class="ticks"></div><div class="bar">${segs}</div></div>
        <div class="rows">${list}</div>`;
      host.appendChild(card);
    });
  }

  /* ============================================================
     3. Priority queues
     ============================================================ */
  function renderQueues(rows, books, minutes) {
    const L = E.lanes(rows, books);
    const defs = [
      { id: 'doubts', cls: 'doubt', title: 'Clear these doubts', why: 'An unresolved question costs more marks per hour than anything else on this page.', items: L.doubts, empty: 'No open doubts in this view.' },
      { id: 'open', cls: 'prog', title: 'Finish what is open', why: 'Half-worked chapters go stale fastest. Closing one is cheaper than starting two.', items: L.open, empty: 'Nothing half-finished.' },
      { id: 'ready', cls: 'nys', title: 'Ready to start', why: 'School or coaching has covered these, so the book work will land on prepared ground.', items: L.ready, empty: 'Everything already taught has been started.' }
    ];

    const host = $('queues');
    host.innerHTML = '';
    defs.forEach(def => {
      const open = V.expanded[def.id];
      const shown = open ? def.items : def.items.slice(0, 6);
      const cost = Math.round(def.items.reduce((n, i) => n + i.cost, 0));

      const body = def.items.length ? `
        <ol>${shown.map((it, i) => `
          <li>
            <span class="rank">${String(i + 1).padStart(2, '0')}</span>
            <span class="body">${esc(it.ch.name)}
              <span class="bk">${esc(it.book)} · ${esc(it.ch.subject)} · ${it.ch.cls === 11 ? 'XI' : 'XII'}</span>
            </span>
            <span class="cost">${Math.round(it.cost)}p</span>
            <button class="go" data-focus="${it.ch.id}" data-book="${esc(it.book)}" title="Load into the timer" aria-label="Load ${esc(it.ch.name)} into the timer">▸</button>
          </li>`).join('')}
        </ol>
        ${def.items.length > 6 ? `<button class="more" data-q="${def.id}">${open ? 'show fewer' : '+ ' + (def.items.length - 6) + ' more'}</button>` : ''}`
        : `<p class="none">${def.empty}</p>`;

      const node = el('div', { class: 'card queue' });
      node.innerHTML = `
        <h4><span class="b ${def.cls}"></span>${def.title}<span class="val">${def.items.length}</span></h4>
        <p class="why">${def.why}${def.items.length ? ` <b style="color:var(--ink)">${pomo(cost)}</b> · ${hours(cost, minutes)}.` : ''}</p>
        ${body}`;
      host.appendChild(node);
    });

    qsa('.more', host).forEach(b => b.onclick = () => {
      V.expanded[b.dataset.q] = !V.expanded[b.dataset.q];
      render();
    });
    qsa('.go', host).forEach(b => b.onclick = () => {
      OS.Timer.assign(b.dataset.focus, b.dataset.book);
      toast('Loaded into the timer', 'good');
    });
  }

  /* ============================================================
     4. Subject balance
     ============================================================ */
  function renderBalance(rows, books, minutes) {
    const show = V.subject === 'All';
    $('balHead').classList.toggle('hidden', !show);
    $('balanceCard').classList.toggle('hidden', !show);
    if (!show) return;

    const host = $('balance');
    host.innerHTML = '';
    C.SUBJECT_ORDER.forEach(sub => {
      const list = rows.filter(r => r.subject === sub);
      if (!list.length) return;
      const t = E.tally(list, books);
      const pct = t.estTotal ? Math.round((1 - t.remaining / t.estTotal) * 100) : 0;
      host.appendChild(el('div', {
        class: 'bl',
        html: `<span class="nm">${esc(sub)}</span>
          <span class="track"><span class="fill" style="width:${pct}%"></span></span>
          <span class="fig">${pct}% · ${pomo(t.remaining)} left</span>`
      }));
    });
  }

  /* ============================================================
     5. Activity — who has been doing what
     ============================================================ */
  const VERB = {
    Completed: 'finished', 'In Progress': 'started', Doubts: 'flagged a doubt on', NYS: 'reset'
  };

  function renderActivity() {
    const host = $('activityBody');
    const me = S.who();
    $('whoAmI').textContent = me ? 'you are ' + me : 'name yourself in settings';

    const people = S.people().filter(p => p.name);
    const today = E.effortByPerson(S);
    const allFeed = E.activity(S);
    const feed = allFeed.slice(0, V.expanded.activity ? 40 : 9);

    const roster = people.length ? `
      <div class="roster">
        ${people.slice(0, 4).map(p => `
          <div class="person ${p.name === me ? 'me' : ''}">
            <span class="nm">${esc(p.name)}${p.name === me ? ' <span class="tag">you</span>' : ''}</span>
            <span class="stat">${today[p.name] ? today[p.name] + ' pom today' : 'nothing logged today'}</span>
            <span class="seen">${esc(ago(p.last))}</span>
          </div>`).join('')}
      </div>` : '';

    if (!feed.length) {
      host.innerHTML = roster + `<p class="none">Nothing has happened on this board yet.
        Once anyone marks a chapter or runs the timer, it shows up here.</p>`;
      return;
    }

    host.innerHTML = roster + `
      <ol class="feed">
        ${feed.map(it => {
          const stDot = it.status ? `<span class="b sm ${C.STATUS_BY_KEY[it.status].cls}"></span>` : '';
          let text;
          if (it.kind === 'pomo') {
            text = `ran a ${it.minutes}-minute session${it.chapter
              ? ` on <b>${esc(it.chapter.name)}</b>${it.book ? ' · ' + esc(it.book) : ''}` : ''}`;
          } else if (it.kind === 'del') {
            text = `deleted <b>${esc(it.chapter.name)}</b>`;
          } else if (it.kind === 'cover') {
            text = `marked <b>${esc(it.chapter.name)}</b> as ${esc(it.status.toLowerCase())} in ${esc(it.book)}`;
          } else {
            text = `${VERB[it.status] || 'changed'} <b>${esc(it.chapter.name)}</b> · ${esc(it.book)}`;
          }
          return `<li class="${it.kind === 'pomo' ? 'pomo' : ''}">
            <span class="mk">${it.kind === 'pomo' ? '◔' : stDot}</span>
            <span class="body"><b class="nm">${esc(it.who)}</b> ${text}</span>
            <span class="when">${esc(ago(it.when))}</span>
          </li>`;
        }).join('')}
      </ol>
      ${allFeed.length > 9
        ? `<button class="more" data-q="activity">${V.expanded.activity ? 'show fewer' : 'show more'}</button>`
        : ''}`;

    const more = qs('[data-q="activity"]', host);
    if (more) more.onclick = () => { V.expanded.activity = !V.expanded.activity; render(); };
  }

  /* ============================================================
     6. Chapter matrix
     ============================================================ */
  function renderMatrix(rows, books, minutes) {
    const editing = S.unlocked;
    const cols = ['School', 'Coaching', ...books];

    $('mhead').innerHTML =
      `<th class="ch">Chapter</th>` +
      cols.map(c => `<th>${esc(c)}${C.BOOK_BY_KEY[c] ? `<span class="sub">${esc(C.BOOK_BY_KEY[c].note)}</span>` : '<span class="sub">taught?</span>'}</th>`).join('') +
      `<th>Left</th>`;

    let list = rows.slice();
    if (V.sort === 'priority') {
      list.sort((a, b) => {
        const sa = books.reduce((n, bk) => n + E.priority(a, bk), 0);
        const sb = books.reduce((n, bk) => n + E.priority(b, bk), 0);
        return sb - sa || a.subject.localeCompare(b.subject) || a.cls - b.cls || a.seq - b.seq;
      });
    } else if (V.sort === 'debt') {
      const rem = ch => books.reduce((n, bk) => n + E.cellRemaining(ch.books[bk]), 0);
      list.sort((a, b) => rem(b) - rem(a));
    } else {
      list.sort((a, b) =>
        C.SUBJECT_ORDER.indexOf(a.subject) - C.SUBJECT_ORDER.indexOf(b.subject) ||
        a.cls - b.cls || a.seq - b.seq);
    }

    const body = $('mbody');
    /* Re-rendering replaces every button, so note which cell had focus
       and put it back afterwards — otherwise a keyboard or screen-reader
       user is thrown to the top of the page after every mark. */
    const act = document.activeElement;
    const focusSel = act && body.contains(act)
      ? (act.dataset.ch ? `.cellbtn[data-ch="${act.dataset.ch}"][data-book="${CSS.escape(act.dataset.book)}"]`
        : act.dataset.cov ? `.cellbtn[data-cov="${act.dataset.cov}"][data-col="${act.dataset.col}"]`
        : act.dataset.est ? `.estinput[data-est="${act.dataset.est}"][data-book="${CSS.escape(act.dataset.book)}"]`
        : null)
      : null;
    body.innerHTML = '';

    if (!list.length) {
      body.innerHTML = `<tr class="noneRow"><td colspan="${cols.length + 2}">
        No chapter matches these filters${V.query ? ` — nothing named “${esc(V.query)}”` : ''}.
        ${editing ? 'Add one with the button above, or clear a filter.' : 'Clear a filter to widen the view.'}
      </td></tr>`;
      return;
    }

    list.forEach(ch => {
      const tr = el('tr');
      const rem = books.reduce((n, bk) => n + E.cellRemaining(ch.books[bk]), 0);
      const hasDoubt = books.some(bk => ch.books[bk]?.s === 'Doubts');
      if (hasDoubt) tr.classList.add('hot');

      const tools = editing
        ? `<span class="rowtools"><button type="button" data-ren="${ch.id}" aria-label="Rename ${esc(ch.name)}">ren</button><button type="button" data-del="${ch.id}" aria-label="Delete ${esc(ch.name)}">del</button></span>`
        : '';

      let html = `<td class="ch"><span class="cls">${ch.cls === 11 ? 'XI' : 'XII'}</span>${esc(ch.name)}${tools}` +
        (V.subject === 'All' ? `<span class="subj">${esc(ch.subject)}</span>` : '') + `</td>`;

      cols.forEach(col => {
        const isBook = !!C.BOOK_BY_KEY[col];
        if (isBook) {
          const cell = ch.books[col];
          if (!cell) { html += `<td><span class="dash">—</span></td>`; return; }
          if (V.mode === 'estimates' && editing) {
            html += `<td><input class="estinput" type="number" min="0" max="99"
              value="${cell.e}" data-est="${ch.id}" data-book="${esc(col)}"
              aria-label="${esc(ch.name)} — ${esc(col)} estimate in pomodoros"></td>`;
            return;
          }
          const st = C.STATUS_BY_KEY[cell.s];
          const dim = (V.focus && V.focus !== cell.s) ? ' dim' : '';
          html += `<td><span class="cell${dim}">
            <button class="cellbtn" type="button" ${editing ? '' : 'disabled tabindex="-1"'}
              data-ch="${ch.id}" data-book="${esc(col)}"
              title="${esc(col)}: ${st.label}${editing ? ' — click to advance; hold or right-click to choose' : ''}"
              aria-label="${esc(ch.name)} — ${esc(col)}: ${st.label}">
              <span class="b ${st.cls}"></span>
            </button></span></td>`;
        } else {
          const v = ch[col] || 'NYS';
          const st = C.STATUS_BY_KEY[v];
          html += `<td><span class="cell">
            <button class="cellbtn" type="button" ${editing ? '' : 'disabled tabindex="-1"'}
              data-cov="${ch.id}" data-col="${col}"
              title="${col}: ${st.label}${editing ? ' — click to advance; hold or right-click to choose' : ''}"
              aria-label="${esc(ch.name)} — taught in ${col}: ${st.label}">
              <span class="b sm ${st.cls}"></span>
            </button></span></td>`;
        }
      });

      html += `<td class="pomo">${rem > 0 ? `<b>${Math.round(rem)}</b>p` : '<span class="dash">·</span>'}</td>`;
      tr.innerHTML = html;
      body.appendChild(tr);
    });

    if (focusSel) { const f = qs(focusSel, body); if (f) f.focus({ preventScroll: true }); }

    /* wiring — one delegated set of listeners on the table body.
       Click advances, shift-click steps back. Phones have no shift key,
       so holding a dot (or right-clicking on a computer) opens a picker
       with all four marks. */
    if (!body.dataset.wired) {
      body.dataset.wired = '1';
      let pressTimer = null, pressed = null, startXY = null, suppressClick = false, longFired = false;
      const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; pressed = null; };

      body.addEventListener('click', e => {
        const btn = e.target.closest('.cellbtn');
        if (!btn || !S.unlocked) return;
        if (suppressClick) { suppressClick = false; return; }
        if (btn.dataset.ch) {
          S.cycleStatus(btn.dataset.ch, btn.dataset.book, e.shiftKey);
        } else if (btn.dataset.cov) {
          /* Coverage buttons carry the chapter id in data-cov, not data-ch. */
          const ch = S.chapter(btn.dataset.cov);
          if (!ch) return;
          const keys = C.STATUS_KEYS;
          const i = keys.indexOf(ch[btn.dataset.col] || 'NYS');
          S.setCoverage(ch.id, btn.dataset.col, keys[(i + (e.shiftKey ? -1 : 1) + keys.length) % keys.length]);
        }
      });
      body.addEventListener('contextmenu', e => {
        const btn = e.target.closest('.cellbtn');
        if (!btn || !S.unlocked) return;
        e.preventDefault();
        cancelPress();
        openPickerFor(btn);
      });
      body.addEventListener('pointerdown', e => {
        const btn = e.target.closest('.cellbtn');
        if (!btn || !S.unlocked || e.pointerType === 'mouse') return;
        pressed = btn; startXY = [e.clientX, e.clientY];
        pressTimer = setTimeout(() => {
          if (!pressed) return;
          suppressClick = true;                 // the finger lifting must not also cycle it
          longFired = true;
          setTimeout(() => { suppressClick = false; longFired = false; }, 800);
          openPickerFor(pressed);
          cancelPress();
        }, 450);
      });
      body.addEventListener('pointermove', e => {
        if (pressed && startXY && Math.hypot(e.clientX - startXY[0], e.clientY - startXY[1]) > 10) cancelPress();
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => body.addEventListener(t, cancelPress));
      /* Stop the browser turning the lifted finger into mouse events,
         which would land on the picker's backdrop. */
      body.addEventListener('touchend', e => { if (longFired) { e.preventDefault(); longFired = false; } }, { passive: false });
    }
    qsa('.estinput', body).forEach(inp => {
      inp.onchange = () => S.setEstimate(inp.dataset.est, inp.dataset.book, +inp.value);
    });
    qsa('[data-ren]', body).forEach(b => b.onclick = () => {
      const ch = S.chapter(b.dataset.ren);
      OS.ask.text('Rename chapter', ch.name, name => {
        if (name && name.trim()) { S.renameChapter(ch.id, name); toast('Renamed', 'good'); }
      }, { maxlength: 120 });
    });
    qsa('[data-del]', body).forEach(b => b.onclick = () => {
      const ch = S.chapter(b.dataset.del);
      OS.ask.confirm(`Delete “${ch.name}” (${ch.subject} · Class ${ch.cls})? Its marks go with it. Undo brings it back.`, 'Delete chapter', () => {
        S.removeChapter(ch.id);
        toast('Chapter deleted — Undo brings it back');
      });
    });
  }

  /* Open the four-mark picker for one matrix cell. */
  function openPickerFor(btn) {
    const isCov = !!btn.dataset.cov;
    const ch = S.chapter(isCov ? btn.dataset.cov : btn.dataset.ch);
    if (!ch) return;
    const key = isCov ? btn.dataset.col : btn.dataset.book;
    const current = isCov ? (ch[key] || 'NYS') : (ch.books[key] && ch.books[key].s);
    OS.Modals.openPicker({
      title: ch.name,
      sub: isCov ? 'Taught in ' + key : key,
      current,
      onPick: status => {
        if (isCov) S.setCoverage(ch.id, key, status);
        else S.setStatus(ch.id, key, status);
        setTimeout(() => {
          const sel = isCov
            ? `.cellbtn[data-cov="${ch.id}"][data-col="${key}"]`
            : `.cellbtn[data-ch="${ch.id}"][data-book="${CSS.escape(key)}"]`;
          const again = qs(sel, $('mbody'));
          if (again) again.focus({ preventScroll: true });
        }, 60);
      }
    });
  }

  /* ============================================================
     6b. Pace chart — pomodoros per day against the quota
     ============================================================ */
  function renderPace() {
    const host = $('paceChart');
    if (!host) return;
    const n = C.PACE_WINDOW || 14;
    const days = E.history(S, n);
    const p = OS.lastPace || {};
    const quota = p.required || S.state.settings.capacity || C.DEFAULT_CAPACITY;
    const max = Math.max(quota, ...days.map(d => d.count), 1);
    const total = days.reduce((a, d) => a + d.count, 0);
    const met = days.filter(d => d.count >= quota).length;

    const W = 300, H = 92, top = 14, base = 70, slot = W / n, bw = Math.max(6, slot * 0.58);
    const y = v => base - (v / max) * (base - top);
    const bars = days.map((d, i) => {
      const x = i * slot + (slot - bw) / 2;
      const h = Math.max(d.count ? 2 : 0, base - y(d.count));
      const cls = d.count >= quota ? 'met' : d.count ? 'part' : 'zero';
      return `<g class="day${d.isToday ? ' today' : ''}">
        ${d.count ? `<rect class="${cls}" x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}"></rect>`
                  : `<rect class="zero" x="${x.toFixed(1)}" y="${base - 1}" width="${bw.toFixed(1)}" height="1"></rect>`}
        <text class="dn" x="${(x + bw / 2).toFixed(1)}" y="${base + 13}" text-anchor="middle">${d.dayNum}</text>
        ${d.isToday ? `<text class="tl" x="${(x + bw / 2).toFixed(1)}" y="${base + 22}" text-anchor="middle">today</text>` : ''}
      </g>`;
    }).join('');
    const qy = y(quota).toFixed(1);

    host.innerHTML = `
      <div class="pace-head">
        <span class="lbl">Last ${n} days</span>
        <span class="fig">${total} pom · ${met}/${n} days at quota</span>
      </div>
      <svg viewBox="0 0 ${W} ${H + 4}" role="img"
        aria-label="Pomodoros logged per day over the last ${n} days: ${total} in total, quota of ${quota} met on ${met} days. Today: ${days[n - 1].count}.">
        <line class="base" x1="0" x2="${W}" y1="${base + .5}" y2="${base + .5}"></line>
        ${bars}
        <line class="quota" x1="0" x2="${W}" y1="${qy}" y2="${qy}"></line>
        <text class="ql" x="${W}" y="${Math.max(9, qy - 4)}" text-anchor="end">quota ${quota}</text>
      </svg>`;
  }

  /* ============================================================
     7. Chrome: tabs, filters, legend, lock state
     ============================================================ */
  function renderChrome(rows, books, allScoped) {
    /* subject tabs */
    const tabs = $('tabs');
    if (!tabs.children.length) {
      ['All', ...C.SUBJECT_ORDER].forEach(s => {
        tabs.appendChild(el('button', {
          class: 'tab', type: 'button', role: 'tab', 'data-subject': s,
          html: `<span>${esc(s)}</span><span class="n"></span>`,
          onclick: () => { V.subject = s; if (V.book !== 'all' && !OS.bookApplies(V.book, s) && s !== 'All') V.book = 'all'; render(); }
        }));
      });
    }
    qsa('.tab', tabs).forEach(t => {
      const s = t.dataset.subject;
      t.setAttribute('aria-selected', s === V.subject);
      const n = S.live().filter(ch =>
        (s === 'All' || ch.subject === s) && (V.cls === 'all' || ch.cls === +V.cls)).length;
      qs('.n', t).textContent = n;
    });

    /* book filter pills — built once, relabelled per subject */
    const bookHost = $('bookPills');
    if (!qs('[data-book]', bookHost)) {
      [{ key: 'all', label: 'All books' }, ...C.BOOKS.map(b => ({ key: b.key, label: b.key }))].forEach(b => {
        bookHost.appendChild(el('button', {
          class: 'pill', type: 'button', 'data-book': b.key, text: b.label,
          onclick: () => { V.book = b.key; render(); }
        }));
      });
    }
    const live = OS.liveBooks(V.subject);
    qsa('[data-book]', bookHost).forEach(p => {
      p.setAttribute('aria-pressed', p.dataset.book === V.book);
      p.classList.toggle('hidden', !(p.dataset.book === 'all' || live.includes(p.dataset.book)));
    });

    qsa('[data-cls]').forEach(p => p.setAttribute('aria-pressed', p.dataset.cls === V.cls));
    qsa('[data-sort]').forEach(p => p.setAttribute('aria-pressed', p.dataset.sort === V.sort));
    $('hideUntaught').setAttribute('aria-pressed', V.hideUntaught);
    $('modeToggle').classList.toggle('hidden', !S.unlocked);
    qsa('[data-mode]').forEach(p => p.setAttribute('aria-pressed', p.dataset.mode === V.mode));

    /* legend doubles as a status filter, with live counts */
    const t = E.tally(rows, books);
    const legend = $('legend');
    if (!legend.children.length) {
      C.DISPLAY_ORDER.forEach(s => {
        legend.appendChild(el('button', {
          class: 'lg', type: 'button', 'data-st': s.key, 'aria-pressed': 'false',
          html: `<span class="b ${s.cls}"></span><span>${s.label}</span><span class="n"></span>`,
          onclick: () => { V.focus = V.focus === s.key ? null : s.key; render(); }
        }));
      });
    }
    qsa('.lg', legend).forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.st === V.focus);
      qs('.n', b).textContent = t.counts[b.dataset.st];
    });

    /* counts + print line */
    $('scopeN').textContent =
      `${rows.length} of ${S.live().length} chapters` +
      (V.query ? ` · ${rows.length} matching` : '') +
      ` · ${books.length} ${books.length === 1 ? 'book' : 'books'}`;

    $('printline').textContent = 'Syllabus status · ' + V.subject +
      (V.cls === 'all' ? '' : ' · Class ' + V.cls) + ' · ' + new Date().toLocaleDateString();

    /* lock chip */
    const chip = $('lockBtn');
    chip.classList.toggle('on', S.unlocked);
    chip.innerHTML = `<span class="key">${S.unlocked ? '◈' : '◇'}</span><span>${S.unlocked ? 'Editing on' : 'Read only'}</span>`;
    chip.setAttribute('aria-pressed', S.unlocked);
    document.body.classList.toggle('is-unlocked', S.unlocked);
    $('addChapterBtn').classList.toggle('hidden', !S.unlocked);
    $('undoBtn').classList.toggle('hidden', !S.unlocked);
  }

  /* ============================================================
     master render
     ============================================================ */
  let raf = null;
  function render() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      writeHash();
      const books = activeBooks();
      const all = scoped();
      const rows = searched(all);
      const minutes = S.state.settings.minutes || C.DEFAULT_MINUTES;

      renderChrome(rows, books, all);
      renderCountdown(rows, books);
      renderBookCards(rows, books, minutes);
      renderQueues(rows, books, minutes);
      OS.Timer.invalidate();
      OS.Timer.render(true);
      renderPace();
      renderActivity();
      renderBalance(rows, books, minutes);
      renderMatrix(rows, books, minutes);
    });
  }

  OS.Views = { render, readHash, writeHash, activeBooks, scoped };
  OS.render = render;
})();
