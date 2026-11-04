/* ============================================================
   merge.js — how two copies of the document become one.

   Runs in two places: in the browser before a push, and inside the
   Netlify function before a write. Same code both sides, so the
   result never depends on who did the merging.

   The rule everywhere is last-write-wins on the smallest field that
   has its own timestamp. That means two people editing different
   chapters, or even different books of the same chapter, both keep
   their work. Two people editing the same cell within the same poll
   window is the only case where one edit loses, and the later one
   wins — which is what you would expect.

   Two things are deliberately NOT merged:
     - epoch: "Reset everything" and "Restore a backup" replace the whole
       board. They bump `epoch`, and a copy with a higher epoch wins
       outright, so a reset cannot be undone by a stale device's merge.
     - tombstones: a removed pomodoro (session.x) and a day whose count
       went back to zero (logT without log) are kept as markers, so the
       removal reaches other devices instead of being merged back in.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.OS = root.OS || {}; root.OS.Merge = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {

  const t = v => (typeof v === 'number' && isFinite(v)) ? v : 0;

  /* One chapter/book cell: {s: status, e: estimate, t: touched at} */
  function mergeCell(a, b) {
    if (!a) return b;
    if (!b) return a;
    return t(b.t) > t(a.t) ? b : a;
  }

  function mergeChapter(a, b) {
    if (!a) return b;
    if (!b) return a;

    /* Deletion is a tombstone, not a removal, so it can propagate.
       A later edit un-deletes; a later delete wins over an edit. */
    const aDel = t(a.dt), bDel = t(b.dt);
    const newer = t(b.t) >= t(a.t) ? b : a;
    const older = newer === b ? a : b;

    const out = Object.assign({}, older, newer);
    out.t = Math.max(t(a.t), t(b.t));

    out.del = (aDel >= bDel ? a.del : b.del) || false;
    out.dt = Math.max(aDel, bDel);

    /* Coverage columns carry their own stamps. */
    const schoolFromB = t(b.tS) > t(a.tS);
    out.School = schoolFromB ? b.School : a.School;
    out.bS = schoolFromB ? b.bS : a.bS;
    out.tS = Math.max(t(a.tS), t(b.tS));

    const coachFromB = t(b.tC) > t(a.tC);
    out.Coaching = coachFromB ? b.Coaching : a.Coaching;
    out.bC = coachFromB ? b.bC : a.bC;
    out.tC = Math.max(t(a.tC), t(b.tC));

    out.books = {};
    const keys = new Set([...Object.keys(a.books || {}), ...Object.keys(b.books || {})]);
    keys.forEach(k => { out.books[k] = mergeCell((a.books || {})[k], (b.books || {})[k]); });

    return out;
  }

  /* The effort log is one number per day, each with its own stamp,
     so a phone logging a pomodoro does not clobber a laptop's count
     for a different day. */
  function mergeLog(a, b) {
    const log = {}, logT = {};
    const al = a.log || {}, bl = b.log || {}, at = a.logT || {}, bt = b.logT || {};
    const days = new Set([...Object.keys(al), ...Object.keys(bl), ...Object.keys(at), ...Object.keys(bt)]);
    days.forEach(d => {
      const useB = t(bt[d]) > t(at[d]);
      /* A side that has touched the day (logT) but holds no count means
         "zero", not "unknown" — that is how removing the last pomodoro
         of a day travels between devices. */
      const aKnows = (d in al) || (d in at);
      const v = useB ? (bl[d] || 0) : (aKnows ? (al[d] || 0) : (bl[d] || 0));
      if (v > 0) log[d] = v;
      const stamp = Math.max(t(at[d]), t(bt[d]));
      if (stamp) logT[d] = stamp;
    });
    return { log, logT };
  }

  function merge(a, b) {
    if (!a) return b;
    if (!b) return a;

    /* A reset or a restored backup replaces the board wholesale. */
    const ea = t(a.epoch), eb = t(b.epoch);
    if (ea !== eb) {
      const w = eb > ea ? b : a;
      return {
        schema: w.schema || 0,
        epoch: t(w.epoch),
        chapters: w.chapters || [],
        settings: w.settings || {},
        log: w.log || {},
        logT: w.logT || {},
        sessions: dedupeSessions(w.sessions || []),
        meta: Object.assign({}, w.meta || {}, { updated: new Date().toISOString() })
      };
    }

    const byId = new Map();
    (a.chapters || []).forEach(c => byId.set(c.id, c));
    (b.chapters || []).forEach(c => {
      byId.set(c.id, byId.has(c.id) ? mergeChapter(byId.get(c.id), c) : c);
    });

    const logs = mergeLog(a, b);

    /* Settings move as one block — they are small, and a half-merged
       set of exam targets would be worse than losing one edit. */
    const settings = t((b.settings || {}).st) > t((a.settings || {}).st)
      ? b.settings : a.settings;

    return {
      schema: Math.max(a.schema || 0, b.schema || 0),
      epoch: ea,
      chapters: [...byId.values()],
      settings: settings || {},
      log: logs.log,
      logT: logs.logT,
      sessions: dedupeSessions([...(a.sessions || []), ...(b.sessions || [])]),
      meta: {
        created: (a.meta && a.meta.created) || (b.meta && b.meta.created) || new Date().toISOString(),
        updated: new Date().toISOString()
      }
    };
  }

  /* One record per session. If either copy marks it removed (x), the
     removal wins, so a -1 on one device is not undone by another. */
  function dedupeSessions(all) {
    const byKey = new Map();
    all.forEach(s => {
      if (!s || !s.at) return;
      const k = s.at + '|' + (s.by || '') + '|' + (s.chapterId || '') + '|' + (s.book || '');
      const had = byKey.get(k);
      if (!had || (s.x && !had.x)) byKey.set(k, s);
    });
    const out = [...byKey.values()];
    out.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
    return out.slice(-800);
  }

  return { merge, mergeChapter, mergeCell, mergeLog };
}));
