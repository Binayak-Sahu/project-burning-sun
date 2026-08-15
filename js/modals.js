/* ============================================================
   modals.js — every overlay in the app.
   openModal() returns a close function; Esc and scrim both close.
   ============================================================ */
window.OS = window.OS || {};

(function () {
  const { $, qs, qsa, esc, el, toast, trapFocus } = OS.ui;
  const C = OS.CONFIG;
  const E = OS.Engine;
  const S = OS.Store;

  let closeCurrent = null;

  function openModal({ title, body, foot, wide, onMount }) {
    if (closeCurrent) closeCurrent();
    const scrim = el('div', { class: 'scrim', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    const modal = el('div', { class: 'modal' + (wide ? ' wide' : '') });
    modal.innerHTML = `
      <div class="modal-head"><h3>${esc(title)}</h3>
        <button class="x" aria-label="Close">✕</button></div>
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ''}`;
    scrim.appendChild(modal);
    document.body.appendChild(scrim);
    const untrap = trapFocus(modal);

    function close() {
      untrap();
      scrim.remove();
      document.removeEventListener('keydown', onEsc, true);
      closeCurrent = null;
    }
    function onEsc(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }

    qs('.x', modal).onclick = close;
    scrim.addEventListener('mousedown', e => { if (e.target === scrim) close(); });
    document.addEventListener('keydown', onEsc, true);
    closeCurrent = close;

    onMount && onMount(modal, close);
    const first = qs('input, button:not(.x), select, textarea', modal);
    first && first.focus();
    return close;
  }

  /* ============================================================
     PIN pad
     ============================================================ */
  function openPin(onSuccess, mode) {
    const setting = mode === 'set';
    let entry = '';
    let stage = 1, firstEntry = '';

    const close = openModal({
      title: setting ? 'Choose a new PIN' : 'Unlock editing',
      body: `
        <p class="help" id="pinHelp">${setting
          ? 'Four to eight digits. Write it somewhere — there is no recovery.'
          : 'Enter your PIN to turn on editing.'}</p>
        ${setting ? '' : '<p class="pinsource" id="pinSource">Checking where to verify this…</p>'}
        <div class="pinwrap" id="pinwrap">
          <div class="pindots" id="pindots"></div>
          <div class="keypad">
            ${[1,2,3,4,5,6,7,8,9].map(n => `<button type="button" data-k="${n}">${n}</button>`).join('')}
            <button type="button" class="wide" data-k="del">del</button>
            <button type="button" data-k="0">0</button>
            <button type="button" class="wide" data-k="ok">ok</button>
          </div>
        </div>
        ${setting ? '' : `<p class="help">Reading is open to anyone with the link; only writing needs this.</p>`}`,
      onMount(modal, closeFn) {
        const dots = qs('#pindots', modal);
        const wrap = qs('#pinwrap', modal);
        const help = qs('#pinHelp', modal);

        function paint() {
          dots.innerHTML = Array.from({ length: Math.max(4, entry.length) },
            (_, i) => `<span class="pindot ${i < entry.length ? 'on' : ''}"></span>`).join('');
        }
        function fail(msg) {
          wrap.classList.add('bad');
          help.textContent = msg;
          setTimeout(() => wrap.classList.remove('bad'), 340);
          entry = ''; paint();
        }
        function submit() {
          if (entry.length < 4) return fail('At least four digits.');
          if (setting) {
            if (stage === 1) {
              firstEntry = entry; entry = ''; stage = 2;
              help.textContent = 'Enter it once more to confirm.';
              paint(); return;
            }
            if (entry !== firstEntry) { stage = 1; firstEntry = ''; return fail('Those did not match. Start again.'); }
            S.setPin(entry);
            closeFn();
            toast('PIN updated', 'good');
            return;
          }
          help.textContent = 'Checking…';
          const attempt = entry;
          Promise.resolve(OS.Sync.checkPin(attempt))
            .then(r => {
              if (r.ok) { closeFn(); onSuccess && onSuccess(attempt); return; }
              if (r.source === 'broken') {
                /* Nothing was actually checked. Saying "wrong PIN" here
                   would send you hunting for the wrong problem. */
                fail('Could not reach the shared board, so nothing was checked.');
                paintSource();
                return;
              }
              fail(r.source === 'server'
                ? 'The server rejected that PIN.'
                : 'Wrong PIN for this browser.');
            })
            .catch(() => fail('Could not check that PIN. Try again.'));
        }
        function key(k) {
          if (k === 'del') entry = entry.slice(0, -1);
          else if (k === 'ok') return submit();
          else if (entry.length < 8) entry += k;
          paint();
        }
        /* Say up front which PIN is being asked for. Getting this wrong
           is the difference between "my PIN is broken" and "my function
           never deployed". */
        function paintSource() {
          const el = qs('#pinSource', modal);
          if (!el || setting) return;
          Promise.resolve(OS.Sync.pinSource()).then(src => {
            el.className = 'pinsource ' + src;
            if (src === 'server') {
              el.innerHTML = '<b>Shared board.</b> Checked against <code>BURN_PIN</code> on the server.';
            } else if (src === 'broken') {
              el.innerHTML = '<b>Shared board is not answering.</b> '
                + esc(OS.Sync.lastError || '') + ' No PIN can be verified until that is fixed.';
            } else {
              el.innerHTML = '<b>This browser only.</b> No shared board here, so the offline PIN applies'
                + (S.state.settings.pinSet ? '.' : ' — still the default <code>1234</code>.');
            }
          });
        }
        paintSource();

        qsa('[data-k]', modal).forEach(b => b.onclick = () => key(b.dataset.k));
        modal.addEventListener('keydown', e => {
          if (/^[0-9]$/.test(e.key)) { e.preventDefault(); key(e.key); }
          else if (e.key === 'Backspace') { e.preventDefault(); key('del'); }
          else if (e.key === 'Enter') { e.preventDefault(); key('ok'); }
        });
        paint();
      }
    });
    return close;
  }

  /* ============================================================
     Settings — targets, pace, PIN, appearance
     ============================================================ */
  function openSettings() {
    const s = S.state.settings;
    openModal({
      title: 'Settings',
      wide: true,
      body: `
        <div class="field">
          <label>Exam targets</label>
          <div class="targetlist" id="targets"></div>
          <div class="field-row" style="margin-top:8px">
            <input class="input" id="tLabel" placeholder="JEE Advanced 2027" aria-label="Target name">
            <input class="input" id="tDate" type="date" aria-label="Target date">
            <button class="btn sm" id="tAdd">Add target</button>
          </div>
          <p class="help">The active target drives the countdown and the daily quota.</p>
        </div>

        <div class="field-row">
          <div class="field">
            <label>Pomodoro length</label>
            <input class="input" id="sMin" type="number" min="5" max="180" value="${s.minutes}">
            <span class="help">Minutes of focus in one unit.</span>
          </div>
          <div class="field">
            <label>Break length</label>
            <input class="input" id="sBreak" type="number" min="1" max="60" value="${s.breakMinutes}">
            <span class="help">Minutes between units.</span>
          </div>
          <div class="field">
            <label>Daily ceiling</label>
            <input class="input" id="sCap" type="number" min="1" max="30" value="${s.capacity}">
            <span class="help">Pomodoros you can honestly sustain.</span>
          </div>
        </div>

        <div class="field">
          <label>Appearance</label>
          <div class="grp">
            <button class="pill" data-theme="auto" type="button" aria-pressed="${s.theme === 'auto'}">Auto</button>
            <button class="pill" data-theme="day" type="button" aria-pressed="${s.theme === 'day'}">Daylight</button>
            <button class="pill" data-theme="dusk" type="button" aria-pressed="${s.theme === 'dusk'}">Dusk</button>
            <button class="pill" data-theme="sun" type="button" aria-pressed="${s.theme === 'sun'}">Burning Sun</button>
          </div>
          <span class="help">Auto follows your phone or laptop's own light and dark setting. Press T to walk through them.</span>
        </div>

        <div class="field">
          <label>Books in play</label>
          <div class="booktoggles" id="bookToggles"></div>
          <p class="help">Switching a book off takes it out of the debt, the queues and the
            chapter sheet. Nothing is deleted — every mark stays in storage, so switching it
            back on for the Advanced phase restores the history exactly as you left it.</p>
        </div>

        <div class="field">
          <label>Shared board</label>
          <p class="help" id="syncState"></p>
          <div class="grp">
            <button class="btn ghost sm" id="sSync" type="button">Test the connection</button>
          </div>
        </div>

        <div class="field">
          <label>Access</label>
          <button class="btn ghost sm" id="sPin" style="align-self:flex-start">Change the offline PIN</button>
          <span class="help">This one only applies when there is no server to ask — opened from a file, or
            deployed without functions. On Netlify the real PIN is the <code>BURN_PIN</code> environment
            variable; change it there and redeploy.</span>
        </div>`,
      foot: `<button class="btn ghost left" id="sWipe">Reset everything</button>
             <button class="btn ghost" id="sClear">Clear progress only</button>
             <button class="btn" id="sSave">Save</button>`,
      onMount(modal, close) {
        function paintTargets() {
          const host = qs('#targets', modal);
          host.innerHTML = '';
          s.targets.forEach(t => {
            const days = E.daysUntil(t.date);
            const row = el('div', {
              class: 'trow' + (t.id === s.activeTarget ? ' active' : ''),
              html: `<span class="radio"></span>
                <span class="nm">${esc(t.label)}</span>
                <span class="dt">${E.fmtDate(t.date)} · ${days === null ? '—' : days + 'd'}</span>
                <button class="rm" aria-label="Remove ${esc(t.label)}">✕</button>`
            });
            row.onclick = e => {
              if (e.target.classList.contains('rm')) {
                if (s.targets.length === 1) { toast('Keep at least one target', 'bad'); return; }
                S.removeTarget(t.id); paintTargets(); OS.render(); return;
              }
              S.set('activeTarget', t.id); paintTargets(); OS.render();
            };
            host.appendChild(row);
          });
        }
        paintTargets();

        qs('#tAdd', modal).onclick = () => {
          const label = qs('#tLabel', modal).value.trim();
          const date = qs('#tDate', modal).value;
          if (!label || !date) { toast('Name and date, both', 'bad'); return; }
          S.addTarget(label, date);
          qs('#tLabel', modal).value = ''; qs('#tDate', modal).value = '';
          paintTargets(); OS.render();
        };

        qsa('[data-theme]', modal).forEach(b => b.onclick = () => {
          S.set('theme', b.dataset.theme);
          OS.applyTheme();
          qsa('[data-theme]', modal).forEach(x => x.setAttribute('aria-pressed', x.dataset.theme === b.dataset.theme));
        });

        const paintBooks = () => {
          const host = qs('#bookToggles', modal);
          host.innerHTML = '';
          C.BOOKS.forEach(b => {
            const on = OS.bookOn(b.key);
            const scope = b.only ? b.only.join(' + ') : 'all three subjects';
            const row = el('button', {
              class: 'booktoggle' + (on ? ' on' : ''),
              type: 'button', 'aria-pressed': String(on),
              html: `<span class="sw"></span>
                <span class="bt-name">${esc(b.key)}</span>
                <span class="bt-scope">${esc(scope)}</span>`
            });
            row.onclick = () => {
              S.setBookOn(b.key, !OS.bookOn(b.key));
              paintBooks(); OS.render();
            };
            host.appendChild(row);
          });
        };
        paintBooks();

        const paintSync = () => {
          const el = qs('#syncState', modal);
          if (!el) return;
          const S2 = OS.Sync;
          if (S2.backend === true) {
            el.innerHTML = '<b>Connected.</b> Everyone with the link sees this board, and edits merge '
              + 'chapter by chapter. Writing is checked against <code>BURN_PIN</code>. ' + esc(S2.label()) + '.';
            return;
          }
          const why = esc(S2.lastError || 'Not checked yet.');
          const fixes = S2.backend === false
            ? '<br>Usually one of: the site was deployed by drag and drop (which skips '
              + '<code>netlify/functions</code>), or the deploy predates it. Deploy from Git or run '
              + '<code>netlify deploy --prod</code>.'
            : '<br>The function is there but failing. Check the function log in Netlify under '
              + 'Deploys, and that <code>@netlify/blobs</code> installed.';
          el.innerHTML = '<b>Not connected.</b> ' + why + fixes
            + '<br>Endpoint: <code>' + esc(OS.CONFIG.API) + '</code>'
            + '<br>Until it connects, this browser keeps its own copy and the offline PIN applies.';
        };
        paintSync();
        qs('#sSync', modal).onclick = () => {
          OS.Sync.backend = null;
          qs('#syncState', modal).textContent = 'Testing…';
          OS.Sync.pull().then(paintSync);
        };

        qs('#sPin', modal).onclick = () => openPin(null, 'set');

        qs('#sSave', modal).onclick = () => {
          S.set('minutes', Math.max(5, +qs('#sMin', modal).value || C.DEFAULT_MINUTES));
          S.set('breakMinutes', Math.max(1, +qs('#sBreak', modal).value || C.DEFAULT_BREAK));
          S.set('capacity', Math.max(1, +qs('#sCap', modal).value || C.DEFAULT_CAPACITY));
          close(); OS.render(); toast('Settings saved', 'good');
        };

        qs('#sClear', modal).onclick = () => {
          if (!confirm('Set every chapter back to “not yet started”? Estimates and chapters stay. Undo with Ctrl+Z.')) return;
          S.resetProgressOnly(); close(); OS.render(); toast('Progress cleared');
        };
        qs('#sWipe', modal).onclick = () => {
          if (!confirm('Wipe chapters, progress and the effort log, back to the shipped syllabus? Your PIN is kept.')) return;
          S.resetAll(); close(); OS.render(); toast('Back to a clean file');
        };
      }
    });
  }

  /* ============================================================
     Backup — export / import JSON
     ============================================================ */
  function openBackup() {
    const json = S.exportJSON();
    const size = (new Blob([json]).size / 1024).toFixed(1);
    openModal({
      title: 'Backup and restore',
      wide: true,
      body: `
        <p class="help">Everything lives in this browser only. Export before you clear browsing data,
        switch phones, or try something reckless.</p>
        <div class="field">
          <label>Your data · ${size} KB · ${S.state.chapters.length} chapters</label>
          <textarea class="input" id="bkText" spellcheck="false" aria-label="Backup JSON">${esc(json)}</textarea>
        </div>
        <div class="field">
          <label>Restore</label>
          <div class="grp">
            <input type="file" id="bkFile" accept="application/json,.json" class="hidden">
            <button class="btn ghost sm" id="bkPick">Choose a .json file</button>
            <button class="btn ghost sm" id="bkPaste">Restore from the box above</button>
          </div>
          <span class="help">Restoring replaces everything currently stored. Ctrl+Z undoes it once.</span>
        </div>

        <div class="field" style="border-top:1px solid var(--rule);padding-top:16px">
          <label>Paste from your sheet</label>
          <p class="help">Open a tab in Google Sheets, select the header row and everything under it,
            copy, and paste it here. Marks are matched to chapters by name; anything new gets added.
            This does not connect to the sheet — it is a one-time paste.</p>
          <div class="field-row" style="margin-bottom:8px">
            <select class="input" id="shSub" aria-label="Which subject is this tab">
              ${C.SUBJECT_ORDER.map(x => `<option>${esc(x)}</option>`).join('')}
            </select>
            <button class="btn sm" id="shGo">Import marks</button>
          </div>
          <textarea class="input" id="shText" spellcheck="false" style="min-height:110px"
            placeholder="School&#9;Coaching&#9;Class&#9;Chapter Name&#9;Exercise&#9;Exemplar&#9;IIG&#9;Cengage&#9;Formula Book&#10;Completed&#9;Completed&#9;11&#9;Sets&#9;Completed&#9;Completed&#9;Completed&#9;NYS&#9;NYS"
            aria-label="Paste sheet rows"></textarea>
        </div>`,
      foot: `<button class="btn ghost left" id="bkCopy">Copy to clipboard</button>
             <button class="btn" id="bkDown">Download .json</button>`,
      onMount(modal, close) {
        qs('#bkDown', modal).onclick = () => {
          const blob = new Blob([S.exportJSON()], { type: 'application/json' });
          const a = el('a', {
            href: URL.createObjectURL(blob),
            download: `burning-sun-${OS.today()}.json`
          });
          document.body.appendChild(a); a.click(); a.remove();
          toast('Backup downloaded', 'good');
        };
        qs('#bkCopy', modal).onclick = async () => {
          try {
            await navigator.clipboard.writeText(S.exportJSON());
            toast('Copied', 'good');
          } catch (e) {
            qs('#bkText', modal).select();
            toast('Press Ctrl+C to copy the selection');
          }
        };
        qs('#bkPick', modal).onclick = () => qs('#bkFile', modal).click();
        qs('#bkFile', modal).onchange = e => {
          const f = e.target.files[0]; if (!f) return;
          const fr = new FileReader();
          fr.onload = () => {
            try {
              const n = S.importJSON(fr.result);
              close(); OS.render(); toast(`Restored ${n} chapters`, 'good');
            } catch (err) { toast(err.message, 'bad'); }
          };
          fr.readAsText(f);
        };
        qs('#shGo', modal).onclick = () => {
          const text = qs('#shText', modal).value.trim();
          if (!text) { toast('Paste the rows first', 'bad'); return; }
          try {
            const r = S.importSheetText(text, qs('#shSub', modal).value);
            close(); OS.render();
            toast(`Updated ${r.updated} chapters` + (r.added ? `, added ${r.added}` : ''), 'good');
          } catch (err) { toast(err.message, 'bad'); }
        };

        qs('#bkPaste', modal).onclick = () => {
          try {
            const n = S.importJSON(qs('#bkText', modal).value);
            close(); OS.render(); toast(`Restored ${n} chapters`, 'good');
          } catch (err) { toast(err.message, 'bad'); }
        };
      }
    });
  }

  /* ============================================================
     Add chapter
     ============================================================ */
  function openAddChapter() {
    openModal({
      title: 'Add a chapter',
      body: `
        <div class="field-row">
          <div class="field"><label>Subject</label>
            <select class="input" id="aSub">${C.SUBJECT_ORDER.map(s => `<option>${esc(s)}</option>`).join('')}</select></div>
          <div class="field"><label>Class</label>
            <select class="input" id="aCls"><option value="11">XI</option><option value="12">XII</option></select></div>
          <div class="field"><label>Effort weight</label>
            <input class="input" id="aW" type="number" step="0.1" min="0.2" max="3" value="1">
            <span class="help">1.0 is average.</span></div>
        </div>
        <div class="field"><label>Chapter name</label>
          <input class="input" id="aName" placeholder="Rotational dynamics — extra drilling"></div>`,
      foot: `<button class="btn" id="aSave">Add chapter</button>`,
      onMount(modal, close) {
        qs('#aSub', modal).value = OS.V.subject === 'All' ? C.SUBJECT_ORDER[0] : OS.V.subject;
        if (OS.V.cls !== 'all') qs('#aCls', modal).value = OS.V.cls;
        const save = () => {
          const name = qs('#aName', modal).value.trim();
          if (!name) { toast('Give it a name', 'bad'); return; }
          S.addChapter({
            subject: qs('#aSub', modal).value,
            cls: qs('#aCls', modal).value,
            name,
            w: +qs('#aW', modal).value || 1
          });
          close(); OS.render(); toast('Chapter added', 'good');
        };
        qs('#aSave', modal).onclick = save;
        qs('#aName', modal).addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
      }
    });
  }

  /* ============================================================
     Keyboard shortcuts
     ============================================================ */
  function openShortcuts() {
    const rows = [
      ['/', 'Jump to search'],
      ['L', 'Lock or unlock editing'],
      ['1 – 4', 'Switch subject tab'],
      ['E', 'Toggle marks / estimates'],
      ['P', 'Start or pause the timer'],
      ['B', 'Open backup and restore'],
      ['S', 'Open settings'],
      ['A', 'Add a chapter (unlocked)'],
      ['T', 'Switch daylight / dusk'],
      ['Ctrl + Z', 'Undo the last edit'],
      ['Ctrl + Shift + Z', 'Redo'],
      ['Esc', 'Close, or clear the search'],
      ['?', 'This list']
    ];
    openModal({
      title: 'Keyboard shortcuts',
      body: `<div class="keys">${rows.map(r =>
        `<div class="keyrow"><kbd>${esc(r[0])}</kbd><span>${esc(r[1])}</span></div>`).join('')}</div>
        <p class="help">In the matrix, click a dot to advance its status and shift-click to step back.</p>`
    });
  }

  OS.Modals = { openModal, openPin, openSettings, openBackup, openAddChapter, openShortcuts, get isOpen() { return !!closeCurrent; } };
})();
