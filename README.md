# Project Burning Sun

> *If you want to shine like a sun, first burn like a sun.* — A. P. J. Abdul Kalam

A shared study board for the Class XI-XII Physics, Chemistry and Maths syllabus.
It tracks every book you work from, prices what is left in 50-minute pomodoros, and
works out the daily quota that clears the syllabus before your exam date.

Everyone with the link sees the same board and it updates itself. Editing needs a
PIN. It keeps working with no signal and catches up when the connection returns.

---

## Deploy to Netlify

**From Git** — push this folder to a repo and connect it. `netlify.toml` sets
everything: no build command, publish `.`, functions in `netlify/functions`.
Netlify installs `@netlify/blobs` from `package.json` on its own.

The function is a **v2 function** (`state.mjs`, `export default`). That matters:
Netlify Blobs configures itself automatically on the v2 runtime, and did not do so
reliably under the older `exports.handler` style. If you ever see *"Netlify Blobs is
not configured for this deploy"*, the deploy did not pick up the v2 runtime — deploy
from Git or the CLI rather than by dropping a folder.

As a last resort the function will also accept explicit credentials: set
`BLOBS_SITE_ID` (your site ID, under Site configuration → General) and `BLOBS_TOKEN`
(a personal access token from User settings → Applications) as environment variables.

**From the CLI**

```bash
npm i -g netlify-cli
netlify deploy --prod
```

Drag-and-drop deploys will *not* work any more — the shared board needs functions,
which only come from a Git or CLI deploy.

### Set the PIN

In Netlify: **Site configuration → Environment variables → Add** a variable named
`BURN_PIN` with whatever digits you want, then redeploy. Until you do, the PIN is
`1234`.

The PIN is checked on the server and never sent to browsers, so a wrong one cannot
write to the board. Reading is open to anyone with the link — that is the point.
Anyone who guesses the PIN can edit, so treat it as a lock on a shed, not a vault.

Saving the variable does not republish the site. Trigger a deploy afterwards, or the
function keeps running with the old value.

### If the PIN is rejected

Open the unlock dialog and read the coloured strip under the keypad. It names which
PIN is being checked, and that is usually the whole answer:

| Strip | Meaning |
|---|---|
| **Shared board** (green) | Checked against `BURN_PIN`. A rejection here is a genuinely wrong PIN. |
| **This browser only** (amber) | No function reachable. `BURN_PIN` is not involved; the offline PIN applies. |
| **Not answering** (red) | The function is deployed but failing. Nothing can be verified. |

For the amber and red cases, **Settings → Shared board → Test the connection** prints
the endpoint, the exact error and the likely fix. The common causes:

- **Deployed by drag and drop.** That publishes the static files and skips
  `netlify/functions` entirely. The catch-all redirect then answers the API path with
  `index.html` and a `200`, which looks like success from the outside. Deploy from Git
  or run `netlify deploy --prod`.
- **The deploy predates the variable.** Redeploy.
- **A stray space in the value.** The comparison is exact and length-sensitive, so
  `"4561 "` will not match `"4561"`.

### Running it locally

```bash
netlify dev            # full stack, shared board included
python3 -m http.server 8080   # front end only, local storage only
```

Opening `index.html` straight from the file system works too. Without a backend the
board quietly runs on this-browser-only storage and says so in the footer.

---

## How sharing works

There is one document on the server. Every browser holds a copy.

- **Reading** — pulls on load, when the tab regains focus, and every 25 seconds
  while visible.
- **Writing** — only an unlocked editor pushes, about a second and a half after
  the last click, so a burst of edits is one write.
- **Merging** — pushes are merged, never overwritten. Every book cell, every
  coverage mark and every day of the effort log carries its own timestamp, so two
  people working on different chapters — or different books of the same chapter —
  both keep their work. Only two people editing the exact same cell inside the same
  poll window will see one edit lose, and the later one wins.
- **Deleting** — a deleted chapter becomes a tombstone so the delete reaches other
  devices instead of the chapter reappearing on the next sync.
- **Offline** — everything keeps working against the local copy. The footer says
  "Offline — saved on this device", and the queued changes go up on reconnect.

The merge rules live in `js/merge.js` and run identically in the browser and in the
function, so the result never depends on who did the merging.

The footer chip is the honest status: *Everyone is up to date*, *Unsaved changes*,
*Offline*, or *This device only*.

---

## Files

```
index.html                  markup and script order
package.json                one dependency, @netlify/blobs
netlify/functions/state.js  the shared board: read, merge, write
netlify.toml                publish dir, headers, SPA redirect
manifest.webmanifest        installable web app
sw.js                       offline cache — bump CACHE when you ship
assets/favicon.svg

styles/tokens.css           colours, type, spacing, motion. Start here.
styles/base.css             reset, graph-paper background, type scale
styles/layout.css           shell, masthead, countdown plate, command bar
styles/components.css       cards, matrix, queues, timer, modals, toasts

js/config.js                books, statuses, pomodoro constants
js/seed.js                  the syllabus, with per-chapter effort weights
js/ui.js                    escaping, DOM building, toasts, focus trap
js/merge.js                 conflict rules, shared with the function
js/store.js                 localStorage, undo, timestamps, import/export
js/sync.js                  pull, push, status chip
js/engine.js                pure maths: debt, quota, pace, priority
js/timer.js                 the 50-minute clock and effort ledger
js/views.js                 all rendering
js/modals.js                PIN pad, settings, backup, add chapter
js/app.js                   boot, keyboard, service worker
```

Load order matters: `config → seed → ui → merge → store → sync → engine → timer → views → modals → app`.

---

## How the effort maths works

Each chapter carries an effort weight `w`, where `1.0` is an average chapter.
Each book carries a multiplier. The default estimate for one chapter in one book is

```
pomodoros = round(POMO_BASE × w × bookMultiplier)     // POMO_BASE = 4
```

What is still owed on a cell depends on its mark:

| Mark | Remaining |
|---|---|
| Not yet started | 100% |
| In progress | 50% |
| Doubts | 30% |
| Completed | 0% |

Sum that across everything in view and you get **study debt**. Divide by calendar
days to the active target and you get the **daily quota**. Compare that to your
declared daily ceiling and the plate returns one of three verdicts: on track,
tight, or behind.

Every number is editable. Unlock editing, switch the matrix to **Estimates**, and
type over anything that does not match your experience.

---

## Editing and the PIN

The board opens read-only so anyone can look without nudging anything. Press
<kbd>L</kbd> or click **Read only** to unlock, and the PIN is checked by the server.
It is remembered for that browser tab only — close the tab and it locks again.

The **Change the offline PIN** button in Settings only affects copies running with
no backend. On Netlify, change `BURN_PIN` and redeploy.

Unlocked, you can click any dot to advance its status (shift-click steps back),
rename and delete chapters, add new ones, and edit estimates. <kbd>Ctrl</kbd>+<kbd>Z</kbd>
undoes the last 40 changes.

## Books in play, and the two phases

Seven books are loaded from the workbook. Only four count right now:

| Book | Subjects | In play |
|---|---|---|
| Exercise | all three | yes |
| Exemplar | all three | yes |
| HC Verma | Physics | yes |
| IIG | all three | yes |
| FIITJEE | Physics, Maths | parked |
| Cengage | Chemistry, Maths | parked — for Advanced |
| IRODOV | Physics | parked — for Advanced |

A parked book is out of the debt, the queues, the book cards and the chapter sheet.
**Its marks are not deleted.** Every status you had in FIITJEE is still in storage,
and everything Cengage and Irodov carried from the workbook is seeded and waiting.

Switch them in **Settings → Books in play**. The toggle is part of the shared
document, so parking a book parks it for everyone.

What that looks like in workload terms:

| Phase | Debt | Hours | Done |
|---|---|---|---|
| Main — the four in play | 678 pom | 565 h | 40% |
| Advanced — add Irodov and Cengage | 1,188 pom | 990 h | 29% |
| Everything on | 1,476 pom | 1,230 h | 26% |

The percentage falls when you add a book because the finish line moves, not because
you lost ground. Worth knowing before you flip them on the week after Main.

## Pulling in a sheet later

All three subjects are already loaded from the workbook. If the spreadsheet moves
ahead of the board, open <kbd>B</kbd> → **Paste from your sheet**: in Google Sheets select
the header row and everything under it, copy, pick the subject, and hit **Import
marks**. It reads tab-separated (a Sheets copy) or comma-separated (a CSV download),
matches rows to chapters by name, and adds anything it does not recognise. Column
headers must match the book names.

Nothing connects to the sheet — this is a one-time paste. Do it while unlocked and
the result syncs to everyone.

## Watching someone else's board

Every change stamps the name of whoever made it, and the **Activity** panel turns
those stamps into a feed: who marked what, who ran which session, how long ago.
Above it, a roster shows each person, what they have logged today, and when they
were last seen.

Set your name in **Settings → Your name on this board**. It is stored on your device
only, never synced, so each person keeps their own and nobody overwrites anybody.
Unnamed changes show as "Someone".

A watcher needs no PIN — reading is open. Leave the board locked and it stays a
read-only window onto the work.

One honest limit: only the *latest* change to each cell is kept, so this is a picture
of recent activity rather than a full audit trail. If a chapter is marked done and
then unmarked, the feed shows the unmark, not both. Sessions are a real history and
the last 800 are kept.

## Backups

The board lives on the server, but the server copy is one blob and there is no
version history. Press <kbd>B</kbd> and download the JSON now and then, especially
before a bulk import or a reset.

---

## Shortcuts

| Key | Action |
|---|---|
| <kbd>/</kbd> | Jump to search |
| <kbd>L</kbd> | Lock / unlock editing |
| <kbd>1</kbd>–<kbd>4</kbd> | Switch subject |
| <kbd>E</kbd> | Marks ↔ estimates |
| <kbd>P</kbd> | Start / pause the timer |
| <kbd>B</kbd> | Backup and restore |
| <kbd>S</kbd> | Settings |
| <kbd>A</kbd> | Add a chapter |
| <kbd>T</kbd> | Next theme |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> | Undo |
| <kbd>?</kbd> | Shortcut list |

Filters are written to the URL hash, so any view can be bookmarked.

---

## Customising

**Different books.** Edit `BOOKS` in `js/config.js`. They currently mirror the
source sheet: Exercise, Exemplar, IIG, Cengage, Formula Book. The `only` key can
restrict a book to certain subjects. Existing saved data migrates on next load.

**Different syllabus.** Replace `OS.SEED` in `js/seed.js` with your own
`[name, weight]` pairs, then use *Settings → Reset everything* to reseed.

**Different look.** Every colour and font is a custom property in
`styles/tokens.css`.

**Themes.** Four settings under Appearance:

- **Auto** (default) follows your phone or laptop's light/dark setting, live.
- **Daylight** — the original blueprint on cream graph paper.
- **Dusk** — deliberately not an inverted daylight theme, but a drafting table
  under a desk lamp, status colours lifted in luminance so they read at 1am.
- **Burning Sun** — the one the project is named for. The whole surface is lit
  from one side, as if the page were paper held up to a low sun, and the status
  marks run through the fire: gold for burnt through, orange for still burning,
  red for where it caught wrong. Those three hues sit close together on purpose,
  which is why the four dot shapes stay distinct — tick, half-fill, question mark,
  dashed ring — and carry the meaning on their own.

The header button and <kbd>T</kbd> both walk through them.

**Chapter lists.** All three subjects come from the *To do* workbook, marks
included: 29 Physics, 27 Chemistry, 28 Maths. That includes chapters NCERT has
since dropped but the workbook still tracks — Communication Systems, Environmental
Chemistry, Polymers, Surface Chemistry — and Logarithm, which was never an NCERT
chapter.

**Books** mirror the workbook, minus Formula Book. In `js/config.js`, `only`
restricts a book to certain subjects and `on` is its shipped default; the live
answer is `settings.books`, which the Settings panel writes. Topics NCERT dropped
but JEE still tests — gaseous state, s-block, p-block, solid state, surface
chemistry — are included and flagged `extra: true` in the seed so you can find
and delete them if you are preparing for boards only.

---

## Browser support

Modern Chrome, Safari, Firefox and Edge. Uses `localStorage`, `IntersectionObserver`,
`backdrop-filter` and `color-mix`, all with graceful degradation. Private-browsing
modes that block storage show a warning and run without saving locally, though the
shared board still works.
