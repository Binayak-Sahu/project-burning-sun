/* ============================================================
   timer.js — one unit of effort, counted honestly.
   Survives tab switches by storing the wall-clock end time, so a
   backgrounded tab does not lose minutes to throttled intervals.
   ============================================================ */
window.OS = window.OS || {};

(function () {
  const { $, qs, qsa, esc, el, toast } = OS.ui;
  const C = OS.CONFIG;
  const S = OS.Store;

  const T = {
    chapterId: null,
    book: null,
    phase: 'idle',      // idle | focus | break
    endsAt: null,
    remaining: null,    // ms, when paused
    tick: null,

    minutes() { return S.state.settings.minutes || C.DEFAULT_MINUTES; },
    breakMinutes() { return S.state.settings.breakMinutes || C.DEFAULT_BREAK; },

    assign(chapterId, book) {
      this.chapterId = chapterId;
      this.book = book;
      this.render();
      $('timerCard')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },

    start(phase) {
      const mins = phase === 'break' ? this.breakMinutes() : this.minutes();
      this.phase = phase || 'focus';
      this.endsAt = Date.now() + (this.remaining != null ? this.remaining : mins * 60000);
      this.remaining = null;
      this.run();
    },

    pause() {
      if (!this.endsAt) return;
      this.remaining = Math.max(0, this.endsAt - Date.now());
      this.endsAt = null;
      clearInterval(this.tick); this.tick = null;
      this.render();
    },

    reset() {
      clearInterval(this.tick); this.tick = null;
      this.phase = 'idle'; this.endsAt = null; this.remaining = null;
      this.render();
    },

    run() {
      clearInterval(this.tick);
      this.tick = setInterval(() => {
        if (this.endsAt && Date.now() >= this.endsAt) this.complete();
        else this.render();
      }, 500);
      this.render();
    },

    complete() {
      clearInterval(this.tick); this.tick = null;
      const wasFocus = this.phase === 'focus';
      this.endsAt = null; this.remaining = null;

      if (wasFocus) {
        S.logPomodoro(this.chapterId, this.book, this.minutes());
        this.chime();
        const ch = this.chapterId ? S.chapter(this.chapterId) : null;
        toast(`Pomodoro logged${ch ? ' — ' + ch.name : ''}`, 'good');
        /* A chapter you have actually worked on should stop reading NYS. */
        if (ch && this.book && ch.books[this.book] && ch.books[this.book].s === 'NYS') {
          S.setStatus(this.chapterId, this.book, 'In Progress');
        }
        this.phase = 'idle';
        if (Notification && Notification.permission === 'granted') {
          new Notification('Fifty minutes done', { body: 'Stand up. Break for ' + this.breakMinutes() + '.' });
        }
      } else {
        this.phase = 'idle';
        this.chime();
        toast('Break over');
      }
      this.render();
      OS.render();
    },

    msLeft() {
      if (this.endsAt) return Math.max(0, this.endsAt - Date.now());
      if (this.remaining != null) return this.remaining;
      return (this.phase === 'break' ? this.breakMinutes() : this.minutes()) * 60000;
    },

    chime() {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const now = ctx.currentTime;
        [660, 880].forEach((f, i) => {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sine'; o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, now + i * 0.18);
          g.gain.exponentialRampToValueAtTime(0.16, now + i * 0.18 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.42);
          o.connect(g); g.connect(ctx.destination);
          o.start(now + i * 0.18); o.stop(now + i * 0.18 + 0.45);
        });
        setTimeout(() => ctx.close(), 1400);
      } catch (e) { /* silence is acceptable */ }
    },

    render() {
      const host = $('timerBody');
      if (!host) return;
      const card = $('timerCard');
      const running = !!this.endsAt;
      card.classList.toggle('running', running && this.phase === 'focus');

      const total = (this.phase === 'break' ? this.breakMinutes() : this.minutes()) * 60000;
      const left = this.msLeft();
      const frac = total ? 1 - left / total : 0;
      const mm = String(Math.floor(left / 60000)).padStart(2, '0');
      const ss = String(Math.floor(left % 60000 / 1000)).padStart(2, '0');

      const R = 47, CIRC = 2 * Math.PI * R;
      const ch = this.chapterId ? S.chapter(this.chapterId) : null;

      const settings = S.state.settings;
      const done = S.loggedToday();
      const quota = (OS.lastPace && OS.lastPace.required) || settings.capacity;
      const pips = Math.max(quota, done, 1);

      host.innerHTML = `
        <div class="dialwrap">
          <div class="dial">
            <svg viewBox="0 0 108 108" width="108" height="108" aria-hidden="true">
              <circle class="track" cx="54" cy="54" r="${R}" fill="none" stroke-width="6"></circle>
              <circle class="prog-ring" cx="54" cy="54" r="${R}" fill="none" stroke-width="6"
                stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC * (1 - frac)}" stroke-linecap="butt"></circle>
            </svg>
            <div class="readout">
              <span class="clock">${mm}:${ss}</span>
              <span class="phase">${this.phase === 'break' ? 'break' : running ? 'focus' : 'ready'}</span>
            </div>
          </div>
          <div class="meta">
            <div class="task">
              ${ch ? `${esc(ch.name)}<span class="taskbk">${esc(this.book || '')} · ${esc(ch.subject)}</span>`
                   : `<span class="none">No chapter attached — hit ▸ on any queue item, or just start the clock.</span>`}
            </div>
            <div class="controls">
              ${running
                ? `<button class="btn sm" id="tPause">Pause</button>`
                : `<button class="btn sm accent" id="tStart">${this.remaining != null ? 'Resume' : 'Start ' + this.minutes() + ' min'}</button>`}
              <button class="btn ghost sm" id="tBreak">Break ${this.breakMinutes()}</button>
              <button class="btn ghost sm" id="tReset">Reset</button>
              <span class="nudge">
                <button class="btn ghost sm" id="tMinus" title="Undo a pomodoro logged by mistake"
                  ${done ? '' : 'disabled'} aria-label="Remove one logged pomodoro">&minus;1</button>
                <button class="btn ghost sm" id="tPlus" title="Log a pomodoro you did away from this screen"
                  aria-label="Add one logged pomodoro">+1</button>
              </span>
            </div>
          </div>
        </div>
        <div class="tally" aria-label="${done} of ${quota} pomodoros logged today">
          ${Array.from({ length: Math.min(pips, 24) }, (_, i) =>
            `<span class="pip ${i < done ? (i >= quota ? 'over' : 'filled') : ''}"></span>`).join('')}
          <span class="cap">${done}/${quota} today</span>
        </div>`;

      $('tStart') && ($('tStart').onclick = () => {
        if (Notification && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
        this.start('focus');
      });
      $('tPause') && ($('tPause').onclick = () => this.pause());
      $('tBreak') && ($('tBreak').onclick = () => { this.remaining = null; this.start('break'); });
      $('tReset') && ($('tReset').onclick = () => this.reset());
      $('tPlus') && ($('tPlus').onclick = () => {
        S.logPomodoro(this.chapterId, this.book, this.minutes());
        toast('Logged one pomodoro', 'good');
        OS.render();
      });
      $('tMinus') && ($('tMinus').onclick = () => {
        S.unlogPomodoro()
          ? toast('Removed one pomodoro')
          : toast('Nothing logged today yet', 'bad');
        OS.render();
      });
    }
  };

  /* Keep the page title useful when the tab is in the background. */
  setInterval(() => {
    if (T.endsAt) {
      const left = T.msLeft();
      document.title = `${String(Math.floor(left / 60000)).padStart(2, '0')}:${String(Math.floor(left % 60000 / 1000)).padStart(2, '0')} · ${T.phase === 'break' ? 'break' : 'focus'}`;
    } else if (document.title !== C.APP_NAME) {
      document.title = C.APP_NAME;
    }
  }, 1000);

  OS.Timer = T;
})();
