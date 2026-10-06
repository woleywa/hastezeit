// Tiny view toolkit: auto-escaping html`` templates, toasts, bottom sheets, avatars.

class Safe {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function toHtml(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(toHtml).join('');
  return escape(v);
}

/** Tagged template: interpolated values are escaped unless they are html`` results themselves. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += toHtml(values[i]) + strings[i + 1];
  return new Safe(out);
}
export const raw = (s) => new Safe(String(s));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---- Toast --------------------------------------------------------------------------------------
let toastTimer;
export function toast(message, { action, onAction, duration = 2600 } = {}) {
  const root = document.getElementById('toast-root');
  root.innerHTML = String(html`<div class="toast-wrap"><div class="toast" role="status">
    <span>${message}</span>${action ? html`<button type="button" data-toast-action>${action}</button>` : ''}
  </div></div>`);
  if (action) root.querySelector('[data-toast-action]').onclick = () => {
    root.innerHTML = '';
    onAction?.();
  };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (root.innerHTML = ''), duration);
}

// ---- Bottom sheet -------------------------------------------------------------------------------
let sheetActions = null;
export function openSheet(content, actions = {}) {
  const root = document.getElementById('sheet-root');
  root.innerHTML = String(html`<div class="sheet-backdrop" data-sheet-close></div>
    <section class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>${content}</section>`);
  sheetActions = actions;
  document.body.style.overflow = 'hidden';
  root.querySelector('[autofocus]')?.focus();
}
export function closeSheet() {
  document.getElementById('sheet-root').innerHTML = '';
  sheetActions = null;
  document.body.style.overflow = '';
}
export const currentSheetActions = () => sheetActions;

/** In-page replacement for confirm() (which embedded web views often block). Resolves true/false. */
export function confirmSheet({ title, text = '', confirmLabel = 'Ja', cancelLabel = 'Abbrechen' }) {
  return new Promise((resolve) => {
    const done = (value) => {
      closeSheet();
      resolve(value);
    };
    openSheet(
      html`<h2>${title}</h2>${text ? html`<p class="muted" style="margin:-6px 4px 18px">${text}</p>` : ''}
        <div class="stack">
          <button class="btn danger block lg" data-action="confirm-yes">${confirmLabel}</button>
          <button class="btn ghost block lg" data-action="confirm-no">${cancelLabel}</button>
        </div>`,
      { 'confirm-yes': () => done(true), 'confirm-no': () => done(false) },
    );
  });
}
export const sheetOpen = () => Boolean(document.querySelector('#sheet-root .sheet'));

// ---- Avatars ------------------------------------------------------------------------------------
export function avatar(user, size = '') {
  if (!user) return '';
  const label = user.emoji || (user.name?.[0] ?? '?').toUpperCase();
  return html`<span class="avatar ${size}" style="--c:${user.color ?? '#999'}" title="${user.name}" aria-label="${user.name}">${label}</span>`;
}

export function avatarStack(users, max = 4, size = 'sm') {
  return html`<span class="avatar-stack">${users.slice(0, max).map((u) => avatar(u, size))}</span>`;
}

export function relativeTime(iso) {
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 60) return 'gerade eben';
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  const days = Math.floor(diff / 86400);
  return days === 1 ? 'gestern' : `vor ${days} Tagen`;
}

export function vibrate(ms = 12) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}
