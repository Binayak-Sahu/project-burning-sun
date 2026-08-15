/* ============================================================
   sync.js — keeps this browser and the shared board in step.

   Shape of the thing:
     - Anyone can read. The board pulls on load, on focus, and every
       SYNC_SECONDS while the tab is visible.
     - Only an unlocked editor pushes, and pushes carry the PIN.
     - Every push is a merge, not an overwrite, so two people editing
       different chapters both keep their work.
     - If the backend is missing (opened from a file, or deployed
       without functions) everything still runs, just locally.
   ============================================================ */
window.OS = window.OS || {};

(function () {
  const C = OS.CONFIG;
  const S = OS.Store;

  const Sync = {
    mode: 'unknown',      // unknown | shared | local | offline | error
    lastPull: null,
    lastPush: null,
    rev: 0,
    busy: false,
    dirty: false,
    pin: null,
    message: '',
    _timer: null,
    _pushTimer: null,

    /* The PIN is held for this tab only. Closing it locks again. */
    rememberPin(pin) {
      this.pin = pin;
      try { sessionStorage.setItem('burning-sun/pin', pin); } catch (e) {}
    },
    recallPin() {
      if (this.pin) return this.pin;
      try { this.pin = sessionStorage.getItem('burning-sun/pin'); } catch (e) {}
      return this.pin;
    },
    forgetPin() {
      this.pin = null;
      try { sessionStorage.removeItem('burning-sun/pin'); } catch (e) {}
    },

    /* Strip fields the server has no business storing. */
    payload() {
      const s = S.state;
      return {
        schema: s.schema,
        chapters: s.chapters,
        settings: s.settings,
        log: s.log,
        logT: s.logT,
        sessions: s.sessions,
        meta: s.meta
      };
    },

    async request(method, body) {
      const opts = { method, headers: {} };
      if (body) {
        opts.headers['Content-Type'] = 'application/json';
        if (this.recallPin()) opts.headers['X-Burn-Pin'] = this.pin;
        opts.body = JSON.stringify(body);
      }
      const res = await fetch(C.API, opts);
      let data = null;
      try { data = await res.json(); } catch (e) {}
      if (!res.ok) {
        const err = new Error((data && data.error) || ('Server said ' + res.status));
        err.status = res.status;
        throw err;
      }
      return data;
    },

    /* ---------- is there actually a backend? ----------
       Tri-state, because "cannot tell yet" and "definitely absent" must
       lead to different behaviour:
         true     a function answered with a real board
         false    no function here — offline rules apply
         'error'  something is there but broken; trust nothing
         null     not asked yet
       A static-only deploy is the trap: the catch-all redirect in
       netlify.toml answers /.netlify/functions/state with index.html and
       a 200. So a 200 is not enough — the body has to look like a board. */
    backend: null,
    lastError: '',

    async probe() {
      if (!navigator.onLine) { this.backend = null; this.lastError = 'This device is offline.'; return this.backend; }
      try {
        const res = await fetch(C.API, { headers: { Accept: 'application/json' } });
        if (res.status === 404) {
          this.backend = false;
          this.lastError = 'No function at ' + C.API + ' (404). This deploy has no functions.';
          return this.backend;
        }
        const text = await res.text();
        let data = null;
        try { data = JSON.parse(text); } catch (e) {}

        if (!data) {
          /* HTML came back — almost always the SPA redirect answering
             because the function was never deployed. */
          this.backend = false;
          this.lastError = 'Got a web page instead of data. The function is not deployed — '
            + 'drag-and-drop deploys skip netlify/functions, so deploy from Git or the CLI.';
          return this.backend;
        }
        if (!res.ok) {
          this.backend = 'error';
          /* The function answered, so its own message is the useful one —
             pass it through rather than burying it. */
          this.lastError = data.error || ('Server said ' + res.status + '.');
          return this.backend;
        }
        if (!('doc' in data)) {
          this.backend = 'error';
          this.lastError = 'That endpoint answered, but not with a board.';
          return this.backend;
        }
        this.backend = true;
        this.lastError = '';
        this.probed = data;
        return this.backend;
      } catch (e) {
        this.backend = false;
        this.lastError = 'Could not reach ' + C.API + ' — ' + e.message;
        return this.backend;
      }
    },

    /* Where a PIN would be checked right now, in plain words. */
    async pinSource() {
      if (this.backend === null) await this.probe();
      if (this.backend === true) return 'server';
      if (this.backend === 'error') return 'broken';
      return 'local';
    },

    /* Returns {ok, source, error} — never a bare boolean, because
       "wrong PIN" and "could not ask" must not look the same.

       The old version fell back to the local digest whenever the request
       failed, which meant a site with a broken function silently accepted
       the default 1234 and rejected the real BURN_PIN. It now only falls
       back when there is definitively no backend to ask. */
    async checkPin(pin) {
      const p = String(pin);
      const source = await this.pinSource();

      if (source === 'server') {
        try {
          await this.request('POST', { op: 'auth', pin: p });
          return { ok: true, source: 'server' };
        } catch (e) {
          if (e.status === 401) return { ok: false, source: 'server' };
          this.backend = 'error';
          this.lastError = e.message;
          return { ok: false, source: 'broken', error: e.message };
        }
      }
      if (source === 'broken') {
        return { ok: false, source: 'broken', error: this.lastError };
      }
      return { ok: S.checkPin(p), source: 'local' };
    },

    async pull(quiet) {
      if (this.busy) return;
      if (!navigator.onLine) { this.setMode('offline'); return; }
      this.busy = true;
      if (!quiet) this.setMode(this.mode, 'Checking…');

      const verdict = await this.probe();
      this.busy = false;

      if (verdict === false) { this.setMode('local', ''); return; }
      if (verdict === 'error') { this.setMode('error', ''); return; }
      if (verdict !== true) { this.setMode('offline'); return; }

      const data = this.probed;
      this.lastPull = Date.now();

      if (!data.doc) {
        this.setMode('shared', 'Shared board is empty');
        if (S.unlocked) this.pushNow();
        return;
      }
      if (data.rev !== this.rev) {
        const merged = OS.Merge.merge(this.payload(), data.doc);
        this.rev = data.rev;
        S.adopt(merged);
      }
      this.setMode('shared');
    },

    /* Local edits queue up briefly so a burst of clicks is one write. */
    schedulePush() {
      this.dirty = true;
      this.paint();
      clearTimeout(this._pushTimer);
      this._pushTimer = setTimeout(() => this.pushNow(), 1600);
    },

    async pushNow() {
      if (!S.unlocked || !this.recallPin()) { this.dirty = false; this.paint(); return; }
      if (!navigator.onLine) { this.setMode('offline'); return; }
      if (this.busy) { this.schedulePush(); return; }
      this.busy = true;
      this.setMode(this.mode, 'Saving…');
      try {
        const data = await this.request('POST', { doc: this.payload() });
        this.busy = false;
        this.dirty = false;
        this.rev = data.rev;
        this.lastPush = Date.now();
        this.lastPull = Date.now();
        S.adopt(data.doc);
        this.setMode('shared');
      } catch (e) {
        this.busy = false;
        if (e.status === 401) {
          this.forgetPin();
          this.setMode('shared', 'PIN rejected — unlock again to save');
          OS.toast('The server rejected that PIN. Your changes are still here, unsaved.', 'bad');
        } else {
          this.backend = 'error';
          this.lastError = e.message;
          this.setMode(navigator.onLine ? 'error' : 'offline', 'Not saved — ' + e.message);
        }
      }
    },

    setMode(mode, message) {
      this.mode = mode;
      this.message = message || '';
      this.paint();
    },

    label() {
      if (this.message) return this.message;
      switch (this.mode) {
        case 'shared': {
          if (this.dirty) return 'Unsaved changes';
          if (!this.lastPull) return 'Shared';
          const secs = Math.round((Date.now() - this.lastPull) / 1000);
          if (secs < 10) return 'Everyone is up to date';
          if (secs < 90) return 'Synced ' + secs + 's ago';
          return 'Synced ' + Math.round(secs / 60) + 'm ago';
        }
        case 'error': return 'Shared board is not answering';
        case 'offline': return 'Offline — saved on this device';
        case 'local': return 'This device only';
        default: return 'Connecting…';
      }
    },

    paint() {
      const chip = document.getElementById('netState');
      if (!chip) return;
      const bad = this.mode === 'local' || this.mode === 'offline' || this.mode === 'error';
      const busy = this.busy || this.dirty;
      chip.innerHTML =
        `<span class="dot ${busy ? 'busy' : bad ? 'bad' : ''}"></span><span>${OS.ui.esc(this.label())}</span>`;
      chip.title = this.mode === 'shared'
        ? 'Reading and writing the shared board on this site.'
        : (this.lastError || 'No shared board reachable. Everything is stored in this browser.')
          + ' Open Settings for details.';
    },

    start() {
      this.pull();
      clearInterval(this._timer);
      this._timer = setInterval(() => {
        if (!document.hidden) this.pull(true);
        else this.paint();
      }, (C.SYNC_SECONDS || 25) * 1000);

      document.addEventListener('visibilitychange', () => { if (!document.hidden) this.pull(true); });
      window.addEventListener('online', () => this.pull());
      window.addEventListener('offline', () => this.setMode('offline'));
      setInterval(() => this.paint(), 5000);   // keeps "synced 40s ago" honest
    }
  };

  OS.Sync = Sync;
})();
