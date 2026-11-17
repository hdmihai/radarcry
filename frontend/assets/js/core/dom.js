/**
 * Tiny, dependency-free rendering helpers.
 * Every interpolated value is HTML-escaped unless it is explicitly wrapped with raw()
 * (used only for markup this code generated itself).
 */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

export function raw(s) {
  return s instanceof Raw ? s : new Raw(String(s ?? ''));
}

function flat(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(flat).join('');
  return esc(v);
}

/** Tagged template: html`<b>${userText}</b>` → Raw (safe). */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += flat(values[i]) + strings[i + 1];
  return new Raw(out);
}

/**
 * Tooltip payload: HTML built with html``, escaped once for a data attribute and returned as Raw,
 * so it can be dropped into html`` templates or plain template strings without double escaping.
 */
export function tip(content) {
  return new Raw(esc(flat(content)));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Event delegation: on(root, 'click', '[data-open]', (event, el) => …). */
export function on(root, type, selector, handler, options) {
  const listener = (event) => {
    const el = event.target instanceof Element ? event.target.closest(selector) : null;
    if (el && root.contains(el)) handler(event, el);
  };
  root.addEventListener(type, listener, options);
  return () => root.removeEventListener(type, listener, options);
}

export function setHTML(el, content) {
  if (el) el.innerHTML = flat(content);
}

/** localStorage access that never throws (private mode, blocked storage, previews). */
export const storage = {
  get(key, fallback = null) {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable — the page works without it */
    }
  },
};
