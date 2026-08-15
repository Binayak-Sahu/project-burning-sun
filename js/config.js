/* ============================================================
   config.js — every tunable constant lives here.
   Loaded first. Attaches to window.OS.
   ============================================================ */
window.OS = window.OS || {};

OS.CONFIG = {
  STORE_KEY: 'burning-sun/v1',
  SCHEMA: 3,
  APP_NAME: 'Project Burning Sun',

  /* Shared server copy. Left as a relative path so it works on any
     Netlify site without configuration. */
  API: '/.netlify/functions/state',
  SYNC_SECONDS: 25,

  /* Books tracked per chapter, in display order. These mirror the
     columns in the source sheet exactly.
     `only` would restrict a book to certain subjects (none do now).
     `mult` scales the pomodoro estimate for that book. */
  /* Every book the workbook tracks. `on` is only the default — the
     live answer is settings.books, so a book can be parked without
     losing a single mark. Park FIITJEE and IRODOV through Main, then
     switch IRODOV and Cengage on for Advanced. */
  BOOKS: [
    { key: 'Exercise', note: 'NCERT exercises',   mult: 1.0, on: true },
    { key: 'Exemplar', note: 'NCERT Exemplar',    mult: 0.7, on: true },
    { key: 'HC Verma', note: 'Physics only',      mult: 1.2, on: true,  only: ['Physics'] },
    { key: 'IIG',      note: 'IIG problem book',  mult: 1.3, on: true },
    { key: 'FIITJEE',  note: 'FIITJEE modules',   mult: 1.4, on: false, only: ['Physics', 'Maths'] },
    { key: 'Cengage',  note: 'Cengage — Advanced', mult: 1.5, on: false, only: ['Chemistry', 'Maths'] },
    { key: 'IRODOV',   note: 'Irodov — Advanced',  mult: 1.8, on: false, only: ['Physics'] }
  ],

  /* Coverage columns — not books, just "has this been taught yet". */
  COVERAGE: ['School', 'Coaching'],

  /* The four marks. Order drives the click-cycle and the legend. */
  STATUSES: [
    { key: 'NYS',         cls: 'nys',   label: 'Not yet started', short: 'NYS',  left: 1.00 },
    { key: 'In Progress', cls: 'prog',  label: 'In progress',     short: 'WIP',  left: 0.50 },
    { key: 'Doubts',      cls: 'doubt', label: 'Doubts',          short: 'DBT',  left: 0.30 },
    { key: 'Completed',   cls: 'done',  label: 'Completed',       short: 'DONE', left: 0.00 }
  ],

  /* Single-letter codes used by the seed tables and the sheet importer. */
  CODE: { C: 'Completed', P: 'In Progress', D: 'Doubts', N: 'NYS' },

  /* Effort currency */
  POMO_BASE: 4,          // pomodoros for an average chapter in an average book
  POMO_MIN: 1,
  DEFAULT_MINUTES: 50,   // one unit of effort
  DEFAULT_BREAK: 10,
  DEFAULT_CAPACITY: 8,   // pomodoros you can realistically log per day

  /* Priority scoring for the action queue */
  WEIGHT: { doubt: 100, wip: 40, taught: 12, untaught: 1 },

  PACE_WINDOW: 14,       // days shown in the pace chart
  SUBJECT_ORDER: ['Physics', 'Chemistry', 'Maths']
};

/* Convenience lookups */
OS.CONFIG.BOOK_KEYS = OS.CONFIG.BOOKS.map(b => b.key);
OS.CONFIG.BOOK_BY_KEY = Object.fromEntries(OS.CONFIG.BOOKS.map(b => [b.key, b]));
OS.CONFIG.STATUS_BY_KEY = Object.fromEntries(OS.CONFIG.STATUSES.map(s => [s.key, s]));
OS.CONFIG.STATUS_KEYS = OS.CONFIG.STATUSES.map(s => s.key);

/* Cycle order runs NYS -> WIP -> Doubts -> Completed because that is how work
   actually moves. Reading order is the reverse journey, so it gets its own list. */
OS.CONFIG.DISPLAY_ORDER = ['Completed', 'In Progress', 'Doubts', 'NYS']
  .map(k => OS.CONFIG.STATUS_BY_KEY[k]);

/* Is this book switched on right now? Falls back to the shipped
   default before the store has loaded. */
OS.bookOn = function (bookKey) {
  const chosen = OS.Store && OS.Store.state && OS.Store.state.settings.books;
  if (chosen && bookKey in chosen) return !!chosen[bookKey];
  const b = OS.CONFIG.BOOK_BY_KEY[bookKey];
  return !!(b && b.on);
};

/* Books that are both switched on and relevant to this subject.
   Pass 'All' (or nothing) for every subject. */
OS.liveBooks = function (subject) {
  return OS.CONFIG.BOOK_KEYS.filter(k =>
    OS.bookOn(k) && (!subject || subject === 'All' || OS.bookApplies(k, subject)));
};

/* Does this book apply to this subject? */
OS.bookApplies = function (bookKey, subject) {
  const b = OS.CONFIG.BOOK_BY_KEY[bookKey];
  if (!b) return false;
  return !b.only || b.only.includes(subject);
};

/* Loose text -> canonical status. Used by the seed and the sheet importer. */
OS.readStatus = function (raw) {
  const n = String(raw == null ? '' : raw).toLowerCase().replace(/[^a-z]/g, '');
  if (!n) return null;
  if (n === 'c' || n.indexOf('complete') === 0 || n === 'done') return 'Completed';
  if (n === 'p' || n.indexOf('inprogress') === 0 || n === 'ip' || n.indexOf('ongoing') === 0) return 'In Progress';
  if (n === 'd' || n.indexOf('doubt') === 0) return 'Doubts';
  if (n === 'n' || n === 'nys' || n.indexOf('notstarted') === 0 || n.indexOf('notyet') === 0) return 'NYS';
  return null;
};
