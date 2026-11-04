/* ============================================================
   app.js — boots the thing, wires the chrome, owns the keyboard.
   ============================================================ */
(function () {
  const { $, qs, qsa, el, toast } = OS.ui;
  const S = OS.Store;
  const V = OS.V;

  /* ---------- theme ----------
     Three settings: auto follows the operating system, day and dusk
     pin it. Auto is the default so a phone on night mode opens dark. */
  const prefersDark = window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : { matches: false, addEventListener() {} };

  OS.THEMES = ['day', 'dusk', 'sun'];
  OS.THEME_LABEL = { day: 'Daylight', dusk: 'Dusk', sun: 'Burning Sun' };
  OS.THEME_GLYPH = { day: '☀', dusk: '☾', sun: '✷' };
  OS.THEME_COLOR = { day: '#FAF9F4', dusk: '#0E1720', sun: '#17090A' };

  /* When the page is embedded (for example as a claude.ai artifact) the
     host may set data-theme="dark" or "light" on the root to say which
     theme the viewer picked. Auto follows that first, then the system. */
  let hostTheme = null;
  const root = document.documentElement;
  const readHost = () => {
    const v = root.getAttribute('data-theme');
    if (v === 'dark' || v === 'light') { hostTheme = v; return true; }
    return false;
  };
  readHost();
  if ('MutationObserver' in window) {
    new MutationObserver(() => { if (readHost()) OS.applyTheme(); })
      .observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  }

  OS.resolvedTheme = function () {
    const t = S.state.settings.theme;
    if (OS.THEMES.includes(t)) return t;
    if (hostTheme) return hostTheme === 'dark' ? 'dusk' : 'day';
    return prefersDark.matches ? 'dusk' : 'day';   // auto
  };

  OS.applyTheme = function () {
    const t = OS.resolvedTheme();
    document.documentElement.setAttribute('data-theme', t);
    const meta = qs('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', OS.THEME_COLOR[t]);
    const btn = $('themeBtn');
    if (btn) {
      btn.textContent = OS.THEME_GLYPH[t];
      btn.title = OS.THEME_LABEL[t]
        + (S.state.settings.theme === 'auto' ? ' (following your system)' : '')
        + ' — press T for the next one';
    }
  };

  /* Follow the system while the setting is auto. */
  if (prefersDark.addEventListener) {
    prefersDark.addEventListener('change', () => {
      if (S.state.settings.theme === 'auto') OS.applyTheme();
    });
  }

  /* T walks the three themes rather than flipping two, so Burning Sun
     is reachable without opening settings. */
  OS.toggleTheme = function () {
    const i = OS.THEMES.indexOf(OS.resolvedTheme());
    S.set('theme', OS.THEMES[(i + 1) % OS.THEMES.length]);
    OS.applyTheme();
  };

  /* ---------- lock ---------- */
  function toggleLock() {
    if (S.unlocked) {
      S.unlocked = false;
      OS.Sync.forgetPin();
      if (V.mode === 'estimates') V.mode = 'marks';
      OS.render();
      toast('Locked — read only');
      return;
    }
    OS.Modals.openPin(pin => {
      S.unlocked = true;
      OS.Sync.rememberPin(String(pin));
      /* Without a name every change reads as "Someone", which makes the
         activity feed useless the moment two people share a board. */
      OS.render();
      if (!S.who()) {
        setTimeout(() => OS.ask.text('Your name, so the board can show who did what', '', name => {
          if (name && name.trim()) { S.setWho(name); OS.render(); toast('Hi, ' + S.who(), 'good'); }
        }, { maxlength: 24, cancel: 'Skip' }), 0);
      }
      toast(OS.Sync.mode === 'shared'
        ? 'Editing on — changes go to everyone'
        : 'Editing on — click any dot to change it', 'good');
      /* Pull first, then send anything this device did while locked
         (pomodoros logged without the PIN), merged on the server. */
      Promise.resolve(OS.Sync.pull()).then(() => { if (S.unlocked) OS.Sync.schedulePush(); });
    });
  }

  /* ---------- boot ---------- */
  S.load();
  OS.applyTheme();
  OS.Views.readHash();

  S.on(() => OS.render());
  OS.Timer.restore();          // picks up a timer that was running before a reload
  OS.render();

  /* "Today" moves at midnight even if nobody touches the page. */
  (function scheduleMidnight() {
    const n = new Date();
    const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 5);
    setTimeout(() => { OS.render(); scheduleMidnight(); }, next - n);
  })();

  /* Any local mutation queues a push. Store.adopt() also emits, so the
     flag guards against a pull echoing straight back out. */
  let adopting = false;
  const _adopt = S.adopt.bind(S);
  S.adopt = doc => { adopting = true; try { _adopt(doc); } finally { adopting = false; } };
  S.on(() => { if (!adopting && S.unlocked) OS.Sync.schedulePush(); });

  OS.Sync.start();

  /* first-run nudge */
  if (S.fresh) {
    setTimeout(() => toast('Syllabus loaded from your workbook — set your exam date in Settings'), 700);
  }
  if (S.corrupt) {
    setTimeout(() => toast('Saved data was unreadable — started fresh', 'bad'), 700);
  }
  if (OS.storageBlocked) {
    setTimeout(() => toast('This browser blocks storage — nothing will be saved', 'bad'), 900);
  }

  /* ---------- chrome wiring ---------- */
  $('lockBtn').onclick = toggleLock;
  $('settingsBtn').onclick = () => OS.Modals.openSettings();
  $('backupBtn').onclick = () => OS.Modals.openBackup();
  $('helpBtn').onclick = () => OS.Modals.openShortcuts();
  $('addChapterBtn').onclick = () => OS.Modals.openAddChapter();
  $('undoBtn').onclick = () => { S.undo() ? toast('Undone') : toast('Nothing to undo'); };
  $('printBtn').onclick = () => window.print();
  $('themeBtn').onclick = () => OS.toggleTheme();

  qsa('[data-cls]').forEach(p => p.onclick = () => { V.cls = p.dataset.cls; OS.render(); });
  qsa('[data-sort]').forEach(p => p.onclick = () => { V.sort = p.dataset.sort; OS.render(); });
  qsa('[data-mode]').forEach(p => p.onclick = () => { V.mode = p.dataset.mode; OS.render(); });
  $('hideUntaught').onclick = () => { V.hideUntaught = !V.hideUntaught; OS.render(); };

  $('q').oninput = e => { V.query = e.target.value.trim().toLowerCase(); OS.render(); };

  /* sticky command bar shadow */
  const bar = $('commandbar');
  const sentinel = $('barSentinel');
  if ('IntersectionObserver' in window && sentinel) {
    new IntersectionObserver(([e]) => bar.classList.toggle('stuck', !e.isIntersecting),
      { rootMargin: '0px' }).observe(sentinel);
  }

  window.addEventListener('hashchange', () => { OS.Views.readHash(); OS.render(); });

  /* ---------- keyboard ---------- */
  document.addEventListener('keydown', e => {
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select';

    if (e.key === 'Escape' && document.activeElement === $('q')) {
      $('q').value = ''; V.query = ''; OS.render(); $('q').blur(); return;
    }
    if (typing || OS.Modals.isOpen) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault(); e.shiftKey ? S.redo() : S.undo();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) { S.redo() ? toast('Redone') : toast('Nothing to redo'); }
      else { S.undo() ? toast('Undone') : toast('Nothing to undo'); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const k = e.key.toLowerCase();
    if (e.key === '/') { e.preventDefault(); $('q').focus(); return; }
    if (e.key === '?') { e.preventDefault(); OS.Modals.openShortcuts(); return; }
    if (k === 'l') { e.preventDefault(); toggleLock(); return; }
    if (k === 's') { e.preventDefault(); OS.Modals.openSettings(); return; }
    if (k === 'b') { e.preventDefault(); OS.Modals.openBackup(); return; }
    if (k === 'a' && S.unlocked) { e.preventDefault(); OS.Modals.openAddChapter(); return; }
    if (k === 'e' && S.unlocked) { e.preventDefault(); V.mode = V.mode === 'marks' ? 'estimates' : 'marks'; OS.render(); return; }
    if (k === 't') { e.preventDefault(); OS.toggleTheme(); return; }
    if (k === 'p') {
      e.preventDefault();
      OS.Timer.toggle();
      return;
    }
    if (['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault();
      const tabs = ['All', ...OS.CONFIG.SUBJECT_ORDER];
      V.subject = tabs[+e.key - 1] || 'All';
      OS.render();
    }
  });


  /* No "leave this page?" warning any more: a running pomodoro is saved
     on the device and carries on (or gets logged) when the page reopens. */

  /* ---------- service worker ---------- */
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then(reg => {
        /* A new version was deployed: say so instead of silently running
           the old one until the next visit. */
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) {
              toast('A new version is ready — reload to use it', 'good');
            }
          });
        });
      }).catch(() => { /* fine without it */ });
    });
  }
})();
