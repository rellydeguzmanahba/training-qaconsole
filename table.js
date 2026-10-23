import { el } from '../utils/dom.js';

// columns: [{ key, label, render?(row)->Node|string, sort?(row)->value, nosort? }]
// Returns an element with .setRows(rows). Client-side sort + paging; cells are built with el() (no raw HTML).
export function dataTable({ columns, rows, pageSize = 25, empty = 'No records found.', initialSort = null }) {
  let data = rows;
  const st = { page: 1, key: initialSort?.key ?? null, dir: initialSort?.dir ?? 'asc' };
  const host = el('div');

  const cmp = (a, b) => {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return typeof a === 'number' && typeof b === 'number' ? a - b
      : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  };

  function view() {
    const col = columns.find((c) => c.key === st.key);
    if (!col) return data;
    const f = col.sort || ((r) => r[col.key]);
    const sign = st.dir === 'asc' ? 1 : -1;
    return [...data].sort((a, b) => sign * cmp(f(a), f(b)));
  }

  function draw() {
    const all = view();
    const pages = Math.max(1, Math.ceil(all.length / pageSize));
    st.page = Math.min(st.page, pages);
    const slice = all.slice((st.page - 1) * pageSize, st.page * pageSize);

    const head = el('tr', {}, columns.map((c) => {
      const th = el('th', { scope: 'col' });
      if (c.nosort) { th.append(c.label); return th; }
      const active = st.key === c.key;
      th.setAttribute('aria-sort', active ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      th.append(el('button', { type: 'button', class: 'th-btn', onclick: () => {
        if (st.key === c.key) st.dir = st.dir === 'asc' ? 'desc' : 'asc'; else { st.key = c.key; st.dir = 'asc'; }
        draw();
      } }, c.label, active ? (st.dir === 'asc' ? ' ▲' : ' ▼') : ''));
      return th;
    }));

    const body = slice.map((r) => el('tr', {}, columns.map((c) => {
      const v = c.render ? c.render(r) : r[c.key];
      return el('td', { 'data-label': c.label }, v == null || v === '' ? '—' : v);
    })));

    const table = el('table', { class: 'table table--stack' }, el('thead', {}, head), el('tbody', {}, body));
    const parts = [el('div', { class: 'table-wrap' }, table)];
    if (!all.length) parts[0] = el('div', { class: 'empty muted' }, empty);
    else {
      parts.push(el('div', { class: 'pager' },
        el('span', {}, `${(st.page - 1) * pageSize + 1}–${(st.page - 1) * pageSize + slice.length} of ${all.length}`),
        el('span', { class: 'row' },
          el('button', { type: 'button', class: 'btn btn--sm', disabled: st.page <= 1, onclick: () => { st.page--; draw(); } }, 'Previous'),
          el('button', { type: 'button', class: 'btn btn--sm', disabled: st.page >= pages, onclick: () => { st.page++; draw(); } }, 'Next'))));
    }
    host.replaceChildren(...parts);
  }

  host.setRows = (r) => { data = r; st.page = 1; draw(); };
  draw();
  return host;
}
