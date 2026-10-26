import { el } from '../utils/dom.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

// Circular progress. value 0-100.
export function ringGauge(value, { size = 112, stroke = 11, label = '' } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value));
  const s = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img', 'aria-label': `${label} ${v}%` });
  s.append(svg('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: '#e8e6dd', 'stroke-width': stroke }),
    svg('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: '#0f7a52', 'stroke-width': stroke, 'stroke-linecap': 'round',
      'stroke-dasharray': `${(c * v) / 100} ${c}`, transform: `rotate(-90 ${size / 2} ${size / 2})` }));
  const t = svg('text', { x: '50%', y: '50%', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': size * 0.24, 'font-weight': 700, fill: '#1d2926' });
  t.textContent = `${v}%`; s.append(t);
  return s;
}

// Horizontal bars: items [{label, value, href?}] scaled to the largest value (or `max`).
export function hbars(items, { max = null, suffix = '' } = {}) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return el('div', { class: 'hbars' }, items.map((i) => el('div', { class: 'bar-row' },
    i.href ? el('a', { href: i.href }, i.label) : el('span', {}, i.label),
    el('div', { class: 'bar', role: 'img', 'aria-label': `${i.label}: ${i.value}${suffix}` }, el('span', { style: `width:${Math.round((100 * i.value) / top)}%` })),
    el('span', { class: 'small' }, `${i.value}${suffix}`))));
}

// Column chart: items [{label, value}].
export function columns(items, ariaLabel = '') {
  const top = Math.max(1, ...items.map((i) => i.value));
  return el('div', { class: 'cols', role: 'img', 'aria-label': ariaLabel },
    items.map((i) => el('div', { class: 'col' }, el('b', {}, i.value), el('span', { style: `height:${Math.round((100 * i.value) / top)}%` }), i.label)));
}
