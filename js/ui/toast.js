import { el } from '../utils/dom.js';

export function toast(message, type = 'info', ms = 4000) {
  const box = document.getElementById('toasts');
  const t = el('div', { class: `toast toast--${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
  box.append(t);
  setTimeout(() => t.remove(), ms);
}
