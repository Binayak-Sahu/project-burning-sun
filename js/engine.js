/* ============================================================
   engine.js — pure functions. No DOM, no storage.
   Turns chapter statuses into effort in 50-minute units, then
   into a daily quota and an honest verdict about the deadline.
   ============================================================ */
window.OS = window.OS || {};

(function () {
  const C = OS.CONFIG;

  const DAY = 86400000;
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

  /* Whole calendar days from today until the exam. Exam day itself
     does not count as study time — you are sitting the paper. */
  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const target = startOfDay(new Date(dateStr + 'T00:00:00'));
    if (isNaN(target)) return null;
    return Math.round((target - startOfDay(new Date())) / DAY);
  }

  function fmtDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return '—';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* Remaining pomodoros for a single chapter/book cell. */
  function cellRemaining(cell) {
    if (!cell) return 0;
    const st = C.STATUS_BY_KEY[cell.s];
    if (!st) return 0;
    return Math.round(cell.e * st.left * 10) / 10;
  }

  /* Rolled-up totals for a set of chapters, optionally limited to
     a subset of books. */
  function tally(chapters, bookKeys) {
    const books = bookKeys || OS.liveBooks();
    const out = {
      counts: { Completed: 0, 'In Progress': 0, Doubts: 0, NYS: 0 },
      cells: 0,
      estTotal: 0,
      remaining: 0,
      done: 0,
      perBook: {},
      perSubject: {}
    };
    books.forEach(b => {
      out.perBook[b] = { counts: { Completed: 0, 'In Progress': 0, Doubts: 0, NYS: 0 }, cells: 0, estTotal: 0, remaining: 0 };
    });

    chapters.forEach(ch => {
      const sub = out.perSubject[ch.subject] || (out.perSubject[ch.subject] = { cells: 0, estTotal: 0, remaining: 0, done: 0 });
      books.forEach(b => {
        const cell = ch.books[b];
        if (!cell) return;
        const rem = cellRemaining(cell);
        out.counts[cell.s]++; out.cells++; out.estTotal += cell.e; out.remaining += rem;
        if (cell.s === 'Completed') out.done++;
        const pb = out.perBook[b];
        pb.counts[cell.s]++; pb.cells++; pb.estTotal += cell.e; pb.remaining += rem;
        sub.cells++; sub.estTotal += cell.e; sub.remaining += rem;
        if (cell.s === 'Completed') sub.done++;
      });
    });

    out.remaining = Math.round(out.remaining);
    Object.values(out.perBook).forEach(p => { p.remaining = Math.round(p.remaining); });
    Object.values(out.perSubject).forEach(p => { p.remaining = Math.round(p.remaining); });
    out.pctDone = out.estTotal ? Math.round((1 - out.remaining / out.estTotal) * 100) : 0;
    return out;
  }

  /* How urgently does this cell want attention? Bigger is louder. */
  function priority(ch, bookKey) {
    const cell = ch.books[bookKey];
    if (!cell || cell.s === 'Completed') return 0;
    const W = C.WEIGHT;
    let score = 0;
    if (cell.s === 'Doubts') score = W.doubt;
    else if (cell.s === 'In Progress') score = W.wip;
    else score = (ch.School === 'Completed' || ch.Coaching === 'Completed') ? W.taught : W.untaught;

    /* A chapter you have nearly closed out in other books is cheap to
       finish — nudge it up. Heavy chapters get a small bump too. */
    const sibling = Object.entries(ch.books)
      .filter(([k]) => k !== bookKey)
      .reduce((n, [, c]) => n + (c.s === 'Completed' ? 1 : 0), 0);
    score += sibling * 3;
    score += (ch.w - 1) * 4;
    return score;
  }

  /* Ordered work queue, richest signal first. */
  function actionQueue(chapters, bookKeys, limit) {
    const books = bookKeys || OS.liveBooks();
    const items = [];
    chapters.forEach(ch => books.forEach(b => {
      const cell = ch.books[b];
      if (!cell || cell.s === 'Completed') return;
      const p = priority(ch, b);
      if (!p) return;
      items.push({ ch, book: b, status: cell.s, cost: cellRemaining(cell), score: p });
    }));
    items.sort((a, b) => b.score - a.score || b.cost - a.cost || a.ch.name.localeCompare(b.ch.name));
    return limit ? items.slice(0, limit) : items;
  }

  /* Split queue into the three named lanes the dashboard shows. */
  function lanes(chapters, bookKeys) {
    const all = actionQueue(chapters, bookKeys);
    return {
      doubts: all.filter(i => i.status === 'Doubts'),
      open: all.filter(i => i.status === 'In Progress'),
      ready: all.filter(i => i.status === 'NYS' && (i.ch.School === 'Completed' || i.ch.Coaching === 'Completed'))
    };
  }

  /* --- the pace projection ------------------------------------- */
  function pace(store, remaining) {
    const s = store.state.settings;
    const target = store.activeTarget();
    const days = target ? daysUntil(target.date) : null;
    const capacity = Math.max(1, s.capacity || C.DEFAULT_CAPACITY);
    const loggedToday = store.loggedToday();

    /* Rolling average over the last 7 days that have actually passed. */
    const hist = history(store, 7);
    const activeDays = hist.filter(d => d.count > 0).length;
    const sum = hist.reduce((n, d) => n + d.count, 0);
    const avg7 = Math.round((sum / 7) * 10) / 10;

    const usableDays = days === null ? null : Math.max(0, days);
    const required = usableDays ? Math.ceil(remaining / usableDays) : null;
    const requiredExact = usableDays ? remaining / usableDays : null;

    /* What today still owes, after what has been logged. */
    const todayLeft = required === null ? null : Math.max(0, required - loggedToday);

    /* Where does the current pace actually land you? */
    const paceRate = avg7 > 0 ? avg7 : null;
    let finishDays = null, finishDate = null;
    if (paceRate && remaining > 0) {
      finishDays = Math.ceil(remaining / paceRate);
      finishDate = new Date(Date.now() + finishDays * DAY);
    }
    const slipDays = (finishDays !== null && usableDays !== null) ? finishDays - usableDays : null;

    let verdict = 'unknown';
    if (remaining === 0) verdict = 'done';
    else if (usableDays === 0) verdict = 'behind';
    else if (required !== null) {
      if (required > capacity * 1.15) verdict = 'behind';
      else if (required > capacity * 0.85) verdict = 'tight';
      else verdict = 'ahead';
    }

    /* Hours, because pomodoros are abstract at 3am. */
    const minutes = s.minutes || C.DEFAULT_MINUTES;
    const hoursLeft = Math.round(remaining * minutes / 60);

    return {
      days, usableDays, target, capacity, required, requiredExact, todayLeft,
      loggedToday, avg7, activeDays, sum7: sum, finishDays, finishDate, slipDays,
      verdict, hoursLeft, minutes,
      capacityGap: required === null ? null : required - capacity
    };
  }

  /* Last n days of logged effort, oldest first. */
  function history(store, n) {
    const out = [];
    const base = new Date(); base.setHours(0, 0, 0, 0);
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(base.getTime() - i * DAY);
      const key = d.toLocaleDateString('en-CA');
      out.push({
        key,
        date: d,
        label: d.toLocaleDateString(undefined, { weekday: 'narrow' }),
        dayNum: d.getDate(),
        count: store.state.log[key] || 0,
        isToday: i === 0
      });
    }
    return out;
  }

  /* Consecutive days ending today (or yesterday) with any effort logged. */
  function streak(store) {
    let n = 0;
    const base = new Date(); base.setHours(0, 0, 0, 0);
    for (let i = 0; i < 400; i++) {
      const key = new Date(base.getTime() - i * DAY).toLocaleDateString('en-CA');
      const c = store.state.log[key] || 0;
      if (c > 0) n++;
      else if (i === 0) continue;   // today not started yet — streak survives
      else break;
    }
    return n;
  }

  OS.Engine = {
    daysUntil, fmtDate, cellRemaining, tally, priority,
    actionQueue, lanes, pace, history, streak
  };
})();
