import { ROUTES } from '../routes.js';
import { el } from '../utils/dom.js';
import { icon } from './icons.js';

const KEY = 'ahba.sidebar.collapsed';
const body = document.body;

export function initSidebar(role) {
  const nav = document.getElementById('nav');
  nav.replaceChildren();
  let lastGroup = null;
  for (const r of ROUTES.filter((x) => x.roles.includes(role))) {
    if (r.group && r.group !== lastGroup) nav.append(el('div', { class: 'nav__group' }, r.group));
    lastGroup = r.group || null;
    nav.append(el('a', { class: 'nav__item', href: `#/${r.path}`, dataset: { path: r.path }, title: r.title },
      icon(r.icon), el('span', { class: 'nav__label' }, r.title)));
  }

  const collapse = document.getElementById('collapse');
  collapse.replaceChildren(icon('collapse'));
  try { body.classList.toggle('sidebar-collapsed', localStorage.getItem(KEY) === '1'); } catch { /* storage blocked */ }
  collapse.onclick = () => {
    const on = body.classList.toggle('sidebar-collapsed');
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ }
  };

  const menuBtn = document.getElementById('menu-btn');
  menuBtn.replaceChildren(icon('menu'));
  menuBtn.onclick = () => toggleDrawer(true);
  document.getElementById('scrim').onclick = () => toggleDrawer(false);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleDrawer(false); });
}

export function toggleDrawer(open) {
  body.classList.toggle('drawer-open', open);
  document.getElementById('scrim').hidden = !open;
  document.getElementById('menu-btn').setAttribute('aria-expanded', String(open));
}

export function setActive(path) {
  document.querySelectorAll('.nav__item').forEach((a) => {
    if (a.dataset.path === path) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  toggleDrawer(false);
}
