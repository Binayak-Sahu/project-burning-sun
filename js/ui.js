/* ============================================================
   ui.js — small shared helpers. No app logic lives here.
   ============================================================ */
window.OS = window.OS || {};

(function () {
  const $ = id => document.getElementById(id);
  const qs = (sel, root) => (root || document).querySelector(sel);
  const qsa = (sel, root) => [...(root || document).querySelectorAll(sel)];

  const esc = s => String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* Build an element from a tag, props and children. */
  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (k === 'class') node.className = props[k];
        else if (k === 'html') node.innerHTML = props[k];
        else if (k === 'text') node.textContent = props[k];
        else if (k.startsWith('on') && typeof props[k] === 'function') node.addEventListener(k.slice(2), props[k]);
        else if (props[k] != null && props[k] !== false) node.setAttribute(k, props[k]);
      }
    }
    (children || []).forEach(c => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return node;
  }

  const plural = (n, one, many) => n === 1 ? one : (many || one + 's');

  /* Pomodoros read better as "6 pom · 5h" than as a bare float. */
  function pomo(n) {
    const v = Math.round(n);
    return v.toLocaleString() + ' pom';
  }
  function hours(pomos, minutes) {
    const m = pomos * (minutes || 50);
    if (m < 60) return Math.round(m) + 'm';
    const h = m / 60;
    return (h >= 10 ? Math.round(h) : Math.round(h * 10) / 10) + 'h';
  }

  /* ---------- toasts ---------- */
  function toast(msg, kind) {
    let host = $('toasts');
    if (!host) {
      host = el('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' });
      document.body.appendChild(host);
    }
    const t = el('div', { class: 'toast ' + (kind || ''), text: msg });
    host.appendChild(t);
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 240);
    }, 2400);
  }

  /* ---------- focus trap for modals ---------- */
  function trapFocus(container) {
    const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    function onKey(e) {
      if (e.key !== 'Tab') return;
      const items = qsa(sel, container).filter(n => n.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    container.addEventListener('keydown', onKey);
    return () => container.removeEventListener('keydown', onKey);
  }

  OS.ui = { $, qs, qsa, esc, el, toast, plural, pomo, hours, trapFocus };
  OS.toast = toast;
})();
