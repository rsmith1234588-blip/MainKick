// Runs on the web page. The guard makes re-injection harmless: listeners and the panel are only ever created once.
(() => {
  if (window.__Mainkick) return;

  let host = null;
  let panel = null;
  let visible = false;

  // ----- Page tools used by the panel -----

  // The last text field the user clicked into on the page (not inside the panel): "Insert into page" goes there.
  let lastField = null;
  const isEditable = (el) =>
    el instanceof HTMLElement && !el.closest('mainkick-panel') && (
      el.isContentEditable ||
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLInputElement && /^(text|search|email|url|tel|)$/i.test(el.type))
    ) && !el.disabled && !el.readOnly;

  document.addEventListener('focusin', (e) => {
    const el = e.composedPath?.()[0] || e.target;
    if (isEditable(el)) lastField = el;
  }, true);

  function insertText(text) {
    const el = lastField;
    if (!el || !el.isConnected) return { ok: false, error: 'Click into a text box on the page first, then press Insert.' };
    el.focus();
    // One insertion, exactly like a paste. execCommand keeps the page's undo history and frameworks in sync.
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok && (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      el.setRangeText(text, start, end, 'end');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text }));
      ok = true;
    }
    return ok ? { ok: true } : { ok: false, error: 'This field didn’t accept the text. Try Copy and paste instead.' };
  }

  // Numbered list of visible buttons and links, sent with "Attach page" so the AI can ask to click one.
  const CLICKABLE = 'button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], ' +
    'input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"], summary';
  const MAX_ELEMENTS = 150;
  let elements = [];

  function labelOf(el) {
    const text = el.getAttribute('aria-label') || el.innerText || el.value || el.title ||
      el.getAttribute('alt') || el.querySelector?.('img')?.alt || '';
    return String(text).replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function isVisible(el) {
    if (el.closest('mainkick-panel') || el.disabled || el.getAttribute('aria-hidden') === 'true') return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
  }

  function kindOf(el) {
    const role = el.getAttribute('role');
    if (role) return role;
    if (el.tagName === 'A') return 'link';
    if (el.tagName === 'INPUT') return el.type;
    return el.tagName.toLowerCase();
  }

  function collectElements() {
    elements = [];
    const lines = [];
    for (const el of document.querySelectorAll(CLICKABLE)) {
      if (elements.length >= MAX_ELEMENTS) break;
      if (!isVisible(el)) continue;
      const label = labelOf(el);
      if (!label) continue;
      elements.push({ el, label, kind: kindOf(el) });
      lines.push(`[${elements.length}] ${kindOf(el)} "${label}"`);
    }
    return lines.join('\n');
  }

  function getContext(chars, withElements) {
    const text = (document.body?.innerText || '').slice(0, chars);
    const header = `Page: ${document.title}\nURL: ${location.href}\n\n`;
    if (!withElements) { elements = []; return { text: header + text, clickable: false }; }
    const list = collectElements();
    return {
      text: header + text + (list ? `\n\n[Clickable elements]\n${list}` : ''),
      clickable: !!list
    };
  }

  function describe(n) {
    const item = elements[n - 1];
    return item ? { label: item.label, kind: item.kind, alive: item.el.isConnected } : null;
  }

  function click(n) {
    const item = elements[n - 1];
    if (!item) return { ok: false, error: `There is no element #${n} on the list.` };
    if (!item.el.isConnected) return { ok: false, error: `“${item.label}” is no longer on the page.` };
    item.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    item.el.focus?.({ preventScroll: true });
    item.el.click();
    return { ok: true };
  }

  const pageTools = {
    getContext,
    describe,
    click,
    insertText,
    hasField: () => !!lastField?.isConnected,
    site: () => location.hostname
  };

  // ----- The panel -----

  function ensurePanel() {
    if (host?.isConnected) return;
    panel?.destroy();

    // A custom tag name so the site's CSS (e.g. "div { … }") can't restyle the panel.
    host = document.createElement('mainkick-panel');
    host.style.cssText = [
      'all: initial', 'display: block', 'position: fixed', 'top: 20px', 'right: 20px',
      'width: 400px', 'max-width: calc(100vw - 16px)', 'height: min(600px, calc(100vh - 40px))',
      'max-height: calc(100vh - 16px)',
      'z-index: 2147483647'
    ].join(';');

    // Keep the site's keyboard shortcuts from firing while you type in the panel.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }

    const shadow = host.attachShadow({ mode: 'closed' });
    panel = MainkickPanel.create({ root: shadow, onClose: hide, pageTools });
    makeDraggable(host, panel.dragHandle);
    makeResizable(host, shadow);
    document.documentElement.appendChild(host);
    restoreSize();
  }

  // ----- Resizing: invisible grab strips on every edge and corner -----
  const SIZE_KEY = 'mk_panel_size';
  const MIN_W = 320;
  const MIN_H = 340;

  function clampSize(w, h) {
    return [
      Math.round(Math.min(Math.max(w, MIN_W), window.innerWidth - 16)),
      Math.round(Math.min(Math.max(h, MIN_H), window.innerHeight - 16))
    ];
  }

  async function restoreSize() {
    try {
      const saved = (await chrome.storage.local.get(SIZE_KEY))[SIZE_KEY];
      if (saved?.w && saved?.h && host) {
        const [w, h] = clampSize(saved.w, saved.h);
        host.style.width = w + 'px';
        host.style.height = h + 'px';
      }
    } catch (e) { /* keep the default size */ }
  }

  function makeResizable(el, shadow) {
    const style = document.createElement('style');
    style.textContent = `
      .rz { position: absolute; z-index: 10; touch-action: none; }
      .rz.n, .rz.s { left: 10px; right: 10px; height: 6px; cursor: ns-resize; }
      .rz.e, .rz.w { top: 10px; bottom: 10px; width: 6px; cursor: ew-resize; }
      .rz.n { top: -3px; } .rz.s { bottom: -3px; } .rz.e { right: -3px; } .rz.w { left: -3px; }
      .rz.ne, .rz.nw, .rz.se, .rz.sw { width: 14px; height: 14px; }
      .rz.ne { top: -3px; right: -3px; cursor: nesw-resize; } .rz.sw { bottom: -3px; left: -3px; cursor: nesw-resize; }
      .rz.nw { top: -3px; left: -3px; cursor: nwse-resize; } .rz.se { bottom: -3px; right: -3px; cursor: nwse-resize; }
    `;
    shadow.append(style);

    for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      const h = document.createElement('div');
      h.className = 'rz ' + dir;
      shadow.append(h);
      h.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const r = el.getBoundingClientRect();
        const sx = e.clientX;
        const sy = e.clientY;
        // Pin the panel by its top-left corner so it grows/shrinks from the edge being dragged.
        el.style.left = r.left + 'px';
        el.style.top = r.top + 'px';
        el.style.right = 'auto';
        h.setPointerCapture(e.pointerId);

        const move = (ev) => {
          const dx = ev.clientX - sx;
          const dy = ev.clientY - sy;
          let w = r.width + (dir.includes('e') ? dx : dir.includes('w') ? -dx : 0);
          let hgt = r.height + (dir.includes('s') ? dy : dir.includes('n') ? -dy : 0);
          [w, hgt] = clampSize(w, hgt);
          const left = dir.includes('w') ? Math.max(r.right - w, 0) : r.left;
          const top = dir.includes('n') ? Math.max(r.bottom - hgt, 0) : r.top;
          el.style.width = Math.min(w, window.innerWidth - left) + 'px';
          el.style.height = Math.min(hgt, window.innerHeight - top) + 'px';
          el.style.left = left + 'px';
          el.style.top = top + 'px';
        };
        const up = () => {
          h.removeEventListener('pointermove', move);
          h.removeEventListener('pointerup', up);
          h.removeEventListener('pointercancel', up);
          const box = el.getBoundingClientRect();
          try {
            chrome.storage.local.set({ [SIZE_KEY]: { w: Math.round(box.width), h: Math.round(box.height) } }).catch(() => {});
          } catch (err) { /* extension was reloaded; size just isn't saved */ }
        };
        h.addEventListener('pointermove', move);
        h.addEventListener('pointerup', up);
        h.addEventListener('pointercancel', up);
      });
    }
  }

  function makeDraggable(el, handle) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button, input, select, textarea, a')) return;
      const rect = el.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const x = Math.min(Math.max(ev.clientX - dx, 0), window.innerWidth - rect.width);
        const y = Math.min(Math.max(ev.clientY - dy, 0), window.innerHeight - 48);
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        el.style.right = 'auto';
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  function open() {
    ensurePanel();
    host.style.display = 'block';
    visible = true;
    panel.setVisible(true);
  }

  function hide() {
    if (!host) return;
    host.style.display = 'none';
    visible = false;
    panel.setVisible(false);
  }

  function toggle() {
    if (visible && host?.isConnected) hide();
    else open();
  }

  window.__Mainkick = { open, hide, toggle };
})();
