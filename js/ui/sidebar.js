import { ROUTES, EMPLOYEE_ROUTES } from '../routes.js';
import { el } from '../utils/dom.js';
import { icon } from './icons.js';
import { ensureCss } from '../utils/styles.js';
import { installTabKeys } from './a11y.js';

const KEY = 'ahba.sidebar.collapsed';
const body = document.body;
let escBound = false;

export function initSidebar(role) {
  ensureCss('css/theme.css');
  ensureCss('css/command-center.css');            // design system (scoped to the signed-in app)
  installTabKeys();
  document.body.classList.toggle('role-technician', role === 'technician');
  ensureCss('css/portal.css'); // Attendance workspace styles are needed for admin and trainer too.
  const app = document.getElementById('app');
  const nav = document.getElementById('nav');
  nav.replaceChildren();
  nav.setAttribute('aria-label', 'Main');
  let lastGroup = null;
  for (const r of (role === 'technician' ? EMPLOYEE_ROUTES : ROUTES).filter((x) => x.roles.includes(role))) {
    if (r.group && r.group !== lastGroup) nav.append(el('div', { class: 'nav__group', role: 'presentation' }, r.group));
    lastGroup = r.group || null;
    nav.append(el('a', { class: 'nav__item', href: `#/${r.path}`, dataset: { path: r.path }, title: r.title },
      icon(r.icon), el('span', { class: 'nav__label' }, r.title)));
  }

  // skip link (a button, because "#view" would be read as an app route by the hash router)
  app.querySelector('.skip-link')?.remove();
  app.prepend(el('button', { class: 'skip-link', type: 'button', onclick: () => document.getElementById('view').focus() }, 'Skip to content'));

  // signed-in user card (the top bar hides the name on phones)
  const sidebar = document.getElementById('sidebar'), collapse = document.getElementById('collapse');
  sidebar.querySelector('.sidebar__user')?.remove();
  sidebar.querySelector('.sidebar__build')?.remove();
  const name = document.getElementById('user-name')?.textContent || '', roleText = document.getElementById('user-role')?.textContent || '';
  sidebar.insertBefore(el('div', { class: 'sidebar__user' },
    el('span', { class: 'avatar', 'aria-hidden': 'true' }, name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()),
    el('span', { class: 'sidebar__user-text' }, el('strong', {}, name), el('small', {}, roleText))), collapse);

  sidebar.insertBefore(el('div',{class:'sidebar__build',title:'Dashboard release identifier'},'AHBA Console · Build 2026.10.29.2'),collapse);
  collapse.replaceChildren(icon('collapse'));
  collapse.setAttribute('aria-label', 'Collapse sidebar');
  try { body.classList.toggle('sidebar-collapsed', localStorage.getItem(KEY) === '1'); } catch { /* storage blocked */ }
  collapse.onclick = () => {
    const on = body.classList.toggle('sidebar-collapsed');
    collapse.setAttribute('aria-label', on ? 'Expand sidebar' : 'Collapse sidebar');
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ }
  };

  const menuBtn = document.getElementById('menu-btn');
  menuBtn.replaceChildren(icon('menu'));
  menuBtn.setAttribute('aria-controls', 'sidebar');
  menuBtn.onclick = () => toggleDrawer(true);
  document.getElementById('scrim').onclick = () => toggleDrawer(false);
  if (!escBound) { escBound = true; document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && body.classList.contains('drawer-open')) toggleDrawer(false); }); }
}

export function toggleDrawer(open) {
  const was = body.classList.contains('drawer-open');
  body.classList.toggle('drawer-open', open);
  document.getElementById('scrim').hidden = !open;
  const menuBtn = document.getElementById('menu-btn');
  menuBtn.setAttribute('aria-expanded', String(open));
  const main = document.querySelector('#app .main');
  if (main) main.inert = open && matchMedia('(max-width: 900px)').matches;       // keep focus inside the open drawer
  if (open) document.querySelector('#nav .nav__item')?.focus();
  else if (was) menuBtn.focus();
}

export function setActive(path) {
  document.querySelectorAll('.nav__item').forEach((a) => {
    if (a.dataset.path === path) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (body.classList.contains('drawer-open')) toggleDrawer(false);
}
