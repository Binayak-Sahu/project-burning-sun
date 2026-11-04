/* ============================================================
   timer.js — one unit of effort, counted honestly.

   Time is kept as a wall-clock end time (endsAt), never as a count of
   interval ticks, so a backgrounded tab or a locked phone loses nothing.
   The running timer is also saved on this device, so a reload, a closed
   tab or iOS discarding the page in the background resumes it — and a
   focus block that ran out while the page was gone is still logged, at
   the time it actually ended.

   The card's DOM is built once. Ticks only change text and one SVG
   attribute; rebuilding the buttons every half second used to swallow
   taps on phones and threw keyboard focus away.
   ============================================================ */
window.OS = window.OS || {};

(function () {
  const { $, esc, toast } = OS.ui;
  const C = OS.CONFIG;
  const S = OS.Store;

  const SAVE_KEY = 'burning-sun/timer';      // device-local, never synced
  const R = 47, CIRC = 2 * Math.PI * R;

  /* iOS Safari (outside an installed web app) has no Notification at all;
     touching the bare name there throws and used to kill the Start button. */
  const canNotify = () => typeof window.Notification !== 'undefined';

  const fmt = ms => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };

  const T = {
    chapterId: null,
    book: null,
    phase: 'idle',      // idle | focus | break
    endsAt: null,       // ms epoch while running
    remaining: null,    // ms left while paused
    tick: null,
    mounted: false,
    el: {},
    last: {},           // what is on screen, so render only writes changes

    minutes() { return S.state.settings.minutes || C.DEFAULT_MINUTES; },
    breakMinutes() { return S.state.settings.breakMinutes || C.DEFAULT_BREAK; },
    running() { return !!this.endsAt; },

    /* ---------- persistence ---------- */
    save() {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify({
          chapterId: this.chapterId, book: this.book, phase: this.phase,
          endsAt: this.endsAt, remaining: this.remaining
        }));
      } catch (e) { /* private mode: the timer still works for this visit */ }
    },
    restore() {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) {}
      if (!saved || typeof saved !== 'object') return;
      this.chapterId = saved.chapterId || null;
      this.book = saved.book || null;
      if (saved.phase === 'focus' || saved.phase === 'break') {
        this.phase = saved.phase;
        if (typeof saved.endsAt === 'number') {
          this.endsAt = saved.endsAt;
          if (Date.now() >= this.endsAt) this.complete(true);
          else this.run();
        } else if (typeof saved.remaining === 'number') {
          this.remaining = saved.remaining;
        }
      }
    },

    /* ---------- controls ---------- */
    assign(chapterId, book) {
      this.chapterId = chapterId;
      this.book = book;
      this.save();
      this.render(true);
      $('timerCard')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },

    /* Resume only the phase that was paused; starting the other phase
       begins it fresh (pausing a break and pressing Start used to resume
       the leftover break minutes but call them focus). */
    start(phase) {
      const want = phase || 'focus';
      const resume = this.remaining != null && this.phase === want;
      const mins = want === 'break' ? this.breakMinutes() : this.minutes();
      this.phase = want;
      this.endsAt = Date.now() + (resume ? this.remaining : mins * 60000);
      this.remaining = null;
      this.announce(want === 'break' ? 'Break started' : (resume ? 'Focus resumed' : 'Focus started'));
      this.run();
    },

    pause() {
      if (!this.endsAt) return;
      this.remaining = Math.max(0, this.endsAt - Date.now());
      this.endsAt = null;
      clearInterval(this.tick); this.tick = null;
      this.save();
      this.announce('Paused');
      this.render(true);
    },

    toggle() { this.running() ? this.pause() : this.start(this.phase === 'break' && this.remaining != null ? 'break' : 'focus'); },

    reset() {
      clearInterval(this.tick); this.tick = null;
      this.phase = 'idle'; this.endsAt = null; this.remaining = null;
      this.save();
      this.render(true);
    },

    run() {
      clearInterval(this.tick);
      this.tick = setInterval(() => {
        if (this.endsAt && Date.now() >= this.endsAt) this.complete();
        else this.render();
      }, 500);
      this.save();
      this.render(true);
    },

    /* `late` is true when the block ended while the page was not open. */
    complete(late) {
      clearInterval(this.tick); this.tick = null;
      const wasFocus = this.phase === 'focus';
      const endedAt = this.endsAt || Date.now();
      this.endsAt = null; this.remaining = null;
      this.phase = 'idle';

      if (wasFocus) {
        S.logPomodoro(this.chapterId, this.book, this.minutes(), endedAt);
        const ch = this.chapterId ? S.chapter(this.chapterId) : null;
        /* A chapter you have actually worked on should stop reading NYS. */
        if (ch && this.book && ch.books[this.book] && ch.books[this.book].s === 'NYS') {
          S.setStatus(this.chapterId, this.book, 'In Progress');
        }
        const msg = (late ? 'Logged the pomodoro that finished while you were away' : 'Pomodoro logged')
          + (ch ? ' — ' + ch.name : '');
        if (!late) this.chime();
        toast(msg, 'good');
        this.announce(msg);
        if (!late && canNotify() && Notification.permission === 'granted' && document.hidden) {
          try { new Notification('Focus block done', { body: 'Stand up. Break for ' + this.breakMinutes() + ' minutes.' }); }
          catch (e) { /* some mobile browsers only allow notifications from a service worker */ }
        }
      } else if (!late) {
        this.chime();
        toast('Break over');
        this.announce('Break over');
      }
      this.save();
      this.render(true);
      OS.render && OS.render();
    },

    msLeft() {
      if (this.endsAt) return Math.max(0, this.endsAt - Date.now());
      if (this.remaining != null) return this.remaining;
      return (this.phase === 'break' ? this.breakMinutes() : this.minutes()) * 60000;
    },

    announce(text) { if (this.el.live) this.el.live.textContent = text; },

    chime() {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const t0 = ctx.currentTime;
        [660, 880].forEach((f, i) => {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sine'; o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, t0 + i * 0.18);
          g.gain.exponentialRampToValueAtTime(0.16, t0 + i * 0.18 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.18 + 0.42);
          o.connect(g); g.connect(ctx.destination);
          o.start(t0 + i * 0.18); o.stop(t0 + i * 0.18 + 0.45);
        });
        setTimeout(() => ctx.close(), 1400);
      } catch (e) { /* silence is acceptable */ }
    },

    /* ---------- DOM: built once ---------- */
    mount() {
      const host = $('timerBody');
      if (!host || this.mounted) return;
      host.innerHTML = `
        <div class="dialwrap">
          <div class="dial" id="tDial">
            <svg viewBox="0 0 108 108" aria-hidden="true">
              <circle class="track" cx="54" cy="54" r="${R}" fill="none" stroke-width="6"></circle>
              <circle class="prog-ring" id="tRing" cx="54" cy="54" r="${R}" fill="none" stroke-width="6"
                stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}" stroke-linecap="butt"></circle>
            </svg>
            <div class="readout">
              <span class="clock" id="tClock">00:00</span>
              <span class="phase" id="tPhase">ready</span>
            </div>
          </div>
          <div class="meta">
            <div class="task" id="tTask"></div>
            <div class="controls">
              <button class="btn sm accent" id="tStart" type="button">Start</button>
              <button class="btn ghost sm" id="tBreak" type="button">Break</button>
              <button class="btn ghost sm" id="tReset" type="button">Reset</button>
              <span class="nudge">
                <button class="btn ghost sm" id="tMinus" type="button" title="Remove a pomodoro logged by mistake"
                  aria-label="Remove one logged pomodoro">&minus;1</button>
                <button class="btn ghost sm" id="tPlus" type="button" title="Log a pomodoro you did away from this screen"
                  aria-label="Add one logged pomodoro">+1</button>
              </span>
            </div>
          </div>
        </div>
        <div class="tally" id="tTally"></div>
        <p class="sr" id="tLive" aria-live="polite"></p>`;

      ['Dial', 'Ring', 'Clock', 'Phase', 'Task', 'Start', 'Break', 'Reset', 'Minus', 'Plus', 'Tally', 'Live']
        .forEach(k => { this.el[k.toLowerCase()] = $('t' + k); });

      this.el.start.onclick = () => {
        if (!this.running() && canNotify() && Notification.permission === 'default') {
          try { Notification.requestPermission().catch(() => {}); } catch (e) {}
        }
        this.toggle();
      };
      this.el.break.onclick = () => { this.remaining = null; this.start('break'); };
      this.el.reset.onclick = () => this.reset();
      this.el.plus.onclick = () => {
        S.logPomodoro(this.chapterId, this.book, this.minutes());
        toast('Logged one pomodoro', 'good');
        OS.render();
      };
      this.el.minus.onclick = () => {
        S.unlogPomodoro()
          ? toast('Removed one pomodoro')
          : toast('Nothing logged today yet', 'bad');
        OS.render();
      };
      this.mounted = true;
    },

    /* ---------- render: writes only what changed ---------- */
    set(key, value, write) {
      if (this.last[key] === value) return;
      this.last[key] = value;
      write(value);
    },

    render(full) {
      if (!this.mounted) this.mount();
      if (!this.mounted) return;
      const e = this.el;
      const running = this.running();
      const total = (this.phase === 'break' ? this.breakMinutes() : this.minutes()) * 60000;
      const left = this.msLeft();
      const frac = total ? Math.min(1, Math.max(0, 1 - left / total)) : 0;
      const phaseText = this.phase === 'break' ? 'break' : running ? 'focus' : this.remaining != null ? 'paused' : 'ready';

      this.set('clock', fmt(left), v => { e.clock.textContent = v; });
      this.set('ring', (CIRC * (1 - frac)).toFixed(1), v => e.ring.setAttribute('stroke-dashoffset', v));
      this.set('phase', phaseText, v => { e.phase.textContent = v; });
      this.set('dialLabel', phaseText, v =>
        e.dial.setAttribute('aria-label', 'Timer ' + v + ', ' + fmt(left) + ' left'));
      $('timerCard')?.classList.toggle('running', running && this.phase === 'focus');

      if (!full && !this.last.dirty) return;   // a tick: the clock was all that moved
      this.last.dirty = false;

      const ch = this.chapterId ? S.chapter(this.chapterId) : null;
      const taskKey = ch ? ch.id + '|' + ch.name + '|' + this.book : '';
      this.set('task', taskKey, () => {
        e.task.innerHTML = ch
          ? `${esc(ch.name)}<span class="taskbk">${esc(this.book || '')} · ${esc(ch.subject)}</span>`
          : `<span class="none">No chapter attached. Press ▸ on any item in “Do these next”, or just start the clock.</span>`;
      });

      const startText = running ? 'Pause'
        : this.remaining != null ? 'Resume'
        : 'Start ' + this.minutes() + ' min';
      this.set('start', startText, v => {
        e.start.textContent = v;
        e.start.classList.toggle('accent', !running);
      });
      this.set('break', 'Break ' + this.breakMinutes(), v => { e.break.textContent = v; });

      const done = S.loggedToday();
      e.minus.disabled = !done;

      const quota = (OS.lastPace && OS.lastPace.required) || S.state.settings.capacity;
      const pips = Math.max(quota, done, 1);
      this.set('tally', done + '/' + quota, () => {
        e.tally.setAttribute('aria-label', done + ' of ' + quota + ' pomodoros logged today');
        e.tally.innerHTML =
          Array.from({ length: Math.min(pips, 24) }, (_, i) =>
            `<span class="pip ${i < done ? (i >= quota ? 'over' : 'filled') : ''}"></span>`).join('') +
          `<span class="cap">${done}/${quota} today</span>`;
      });
    },

    /* Anything outside the clock may have changed (settings, a chapter
       rename, today's log): the next render rewrites those parts. */
    invalidate() { this.last.dirty = true; }
  };

  /* Keep the tab title useful when the page is in the background. */
  setInterval(() => {
    if (T.endsAt) {
      document.title = fmt(T.msLeft()) + ' · ' + (T.phase === 'break' ? 'break' : 'focus');
    } else if (document.title !== C.APP_NAME) {
      document.title = C.APP_NAME;
    }
  }, 1000);

  /* Coming back to a tab whose block ran out: finish it immediately
     instead of waiting for the next throttled tick. */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && T.endsAt && Date.now() >= T.endsAt) T.complete();
  });

  OS.Timer = T;
})();
