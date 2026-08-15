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
    out.School = t(b.tS) > t(a.tS) ? b.School : a.School;
    out.tS = Math.max(t(a.tS), t(b.tS));
    out.Coaching = t(b.tC) > t(a.tC) ? b.Coaching : a.Coaching;
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
    new Set([...Object.keys(al), ...Object.keys(bl)]).forEach(d => {
      const useB = t(bt[d]) > t(at[d]);
      const v = useB ? bl[d] : (d in al ? al[d] : bl[d]);
      if (v > 0) { log[d] = v; logT[d] = Math.max(t(at[d]), t(bt[d])); }
    });
    return { log, logT };
  }

  function merge(a, b) {
    if (!a) return b;
    if (!b) return a;

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

  function dedupeSessions(all) {
    const seen = new Set(), out = [];
    all.forEach(s => {
      const k = s.at + '|' + (s.chapterId || '') + '|' + (s.book || '');
      if (seen.has(k)) return;
      seen.add(k); out.push(s);
    });
    out.sort((x, y) => (x.at < y.at ? -1 : 1));
    return out.slice(-800);
  }

  return { merge, mergeChapter, mergeCell, mergeLog };
}));
