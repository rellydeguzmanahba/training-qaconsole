import { el } from '../utils/dom.js';
import { icon } from './icons.js';

const ICON = { success: 'check', error: 'alert', info: 'info' };

export function toast(message, type = 'info', ms = 4500) {
  const box = document.getElementById('toasts');
  while (box.children.length >= 4) box.firstChild.remove();
  let timer;
  const t = el('div', { class: `toast toast--${type}`, role: type === 'error' ? 'alert' : 'status' },
    icon(ICON[type] || 'info', 18), el('span', { class: 'toast__msg' }, message),
    el('button', { class: 'toast__x', type: 'button', 'aria-label': 'Dismiss', onclick: () => t.remove() }, icon('x', 14)));
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => t.remove(), ms); };
  t.addEventListener('mouseenter', () => clearTimeout(timer));       // pause while the pointer is over it
  t.addEventListener('mouseleave', arm);
  box.append(t); arm();
}
