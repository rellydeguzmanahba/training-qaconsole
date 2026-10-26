import { el } from '../utils/dom.js';
import { emptyState } from './states.js';

// Numbered page list with ellipses: pageList(7, 20) -> [1, '…', 6, 7, 8, '…', 20]
export function pageList(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out = new Set([1, pages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => out.add(n));
  if (page >= pages - 2) [pages - 1, pages - 2, pages - 3].forEach((n) => out.add(n));
  const list = [...out].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b), res = [];
  list.forEach((n, i) => { if (i && n - list[i - 1] > 1) res.push('…'); res.push(n); });
  return res;
}

// columns: [{ key, label, render?(row)->Node|string, sort?(row)->value, nosort? }]
// empty: string | { title, text, icon, action }. Client-side sort + paging; cells are built with el() (no raw HTML).
export function dataTable({ columns, rows, pageSize = 25, empty = 'No records found.', initialSort = null, label = 'Data table' }) {
  let data = rows;
  const st = { page: 1, size: pageSize, key: initialSort?.key ?? null, dir: initialSort?.dir ?? 'asc' };
  const host = el('div');

  const cmp = (a, b) => {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return typeof a === 'number' && typeof b === 'number' ? a - b
      : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  };
  const view = () => {
    const col = columns.find((c) => c.key === st.key);
    if (!col) return data;
    const f = col.sort || ((r) => r[col.key]);
    const sign = st.dir === 'asc' ? 1 : -1;
    return [...data].sort((a, b) => sign * cmp(f(a), f(b)));
  };

  function draw() {
    const all = view();
    const pages = Math.max(1, Math.ceil(all.length / st.size));
    st.page = Math.min(st.page, pages);
    const from = (st.page - 1) * st.size, slice = all.slice(from, from + st.size);

    if (!all.length) {
      const e = typeof empty === 'string' ? { title: empty } : empty;
      host.replaceChildren(emptyState({ icon: 'inbox', ...e }));
      return;
    }
    const head = el('tr', {}, columns.map((c) => {
      const th = el('th', { scope: 'col' });
      if (c.nosort) { th.append(c.label); return th; }
      const active = st.key === c.key;
      th.setAttribute('aria-sort', active ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      th.append(el('button', { type: 'button', class: 'th-btn', title: `Sort by ${c.label}`, onclick: () => {
        if (st.key === c.key) st.dir = st.dir === 'asc' ? 'desc' : 'asc'; else { st.key = c.key; st.dir = 'asc'; }
        draw();
      } }, c.label, el('span', { class: 'th-arrow', 'aria-hidden': 'true' }, active ? (st.dir === 'asc' ? '▲' : '▼') : '↕')));
      return th;
    }));
    const body = slice.map((r) => el('tr', {}, columns.map((c) => {
      const v = c.render ? c.render(r) : r[c.key];
      return el('td', { 'data-label': c.label }, v == null || v === '' ? '—' : v);
    })));
    const parts = [el('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': label },
      el('table', { class: 'table table--stack' }, el('thead', {}, head), el('tbody', {}, body)))];

    if (all.length > Math.min(st.size, 10) || pages > 1) {
      const btn = (text, page, opts = {}) => el('button', { type: 'button', class: `pager__btn${opts.current ? ' is-current' : ''}`,
        disabled: opts.disabled, 'aria-label': opts.aria, 'aria-current': opts.current ? 'page' : null, onclick: () => { st.page = page; draw(); } }, text);
      const size = el('select', { class: 'input pager__size', 'aria-label': 'Rows per page' },
        [10, 25, 50, 100].map((n) => el('option', { value: String(n) }, `${n} / page`)));
      size.value = String(st.size);
      size.addEventListener('change', () => { st.size = Number(size.value); st.page = 1; draw(); });
      parts.push(el('div', { class: 'pager' },
        el('span', { class: 'pager__info', 'aria-live': 'polite' }, `Showing ${from + 1}–${from + slice.length} of ${all.length}`),
        el('nav', { class: 'pager__nav', 'aria-label': 'Pagination' },
          btn('‹', st.page - 1, { disabled: st.page <= 1, aria: 'Previous page' }),
          pageList(st.page, pages).map((n) => (n === '…' ? el('span', { class: 'pager__gap', 'aria-hidden': 'true' }, '…') : btn(String(n), n, { current: n === st.page, aria: `Page ${n}` }))),
          btn('›', st.page + 1, { disabled: st.page >= pages, aria: 'Next page' })),
        size));
    }
    host.replaceChildren(...parts);
  }

  host.setRows = (r) => { data = r; st.page = 1; draw(); };
  draw();
  return host;
}
