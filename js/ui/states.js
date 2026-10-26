import { el } from '../utils/dom.js';
import { icon } from './icons.js';

// Shared loading / empty / error states so every module looks and behaves the same.
export const emptyState = ({ icon: name = 'inbox', title, text = null, action = null } = {}) =>
  el('div', { class: 'state' }, el('span', { class: 'state__icon', 'aria-hidden': 'true' }, icon(name, 26)),
    el('h3', {}, title), text ? el('p', { class: 'muted' }, text) : null, action);

export const errorState = (message, onRetry = null) =>
  el('div', { class: 'state state--error', role: 'alert' }, el('span', { class: 'state__icon', 'aria-hidden': 'true' }, icon('alert', 26)),
    el('h3', {}, 'Something went wrong'), el('p', { class: 'muted' }, message),
    onRetry ? el('button', { class: 'btn', type: 'button', onclick: onRetry }, 'Try again') : null);

const line = (w = '100%') => el('div', { class: 'skeleton', style: `width:${w}` });
export const loadingState = () => el('div', { class: 'stack', role: 'status', 'aria-busy': 'true', 'aria-label': 'Loading' },
  el('div', { class: 'grid grid--cards' }, [0, 1, 2, 3].map(() => el('div', { class: 'card stack' }, line('45%'), el('div', { class: 'skeleton skeleton--lg' })))),
  el('div', { class: 'card stack' }, line('30%'), line(), line('92%'), line('80%'), line('86%')));
