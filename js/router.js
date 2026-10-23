import { ROUTES, DEFAULT_ROUTE } from './routes.js';
import { el } from './utils/dom.js';
import { setActive } from './ui/sidebar.js';

let token = 0;       // guards against stale async renders when the user navigates quickly
let current = null;  // module currently shown (for destroy())
let listener = null;

export const navigate = (path) => { location.hash = `#/${path}`; };

function parse() {
  let seg = [];
  try {
    seg = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
  } catch { /* malformed escape -> default route */ }
  return { path: seg[0] || DEFAULT_ROUTE, params: seg.slice(1) };
}

const notice = (title, text) =>
  el('div', { class: 'card empty' }, el('h2', {}, title), el('p', { class: 'muted' }, text));

async function go(ctx) {
  const my = ++token;
  const view = document.getElementById('view');
  const { path, params } = parse();
  const route = ROUTES.find((r) => r.path === path);

  if (current?.destroy) { try { current.destroy(); } catch (e) { console.error(e); } }
  current = null;

  if (!route) {
    setTitle('Not found'); setActive('');
    view.replaceChildren(notice('Page not found', 'That page does not exist.'));
    return;
  }
  setTitle(route.title); setActive(route.path);

  if (!route.roles.includes(ctx.role)) {
    view.replaceChildren(notice('Access restricted', 'Your role does not have access to this page.'));
    return;
  }

  view.replaceChildren(el('div', { class: 'card stack' },
    el('div', { class: 'skeleton', style: 'width:40%' }), el('div', { class: 'skeleton' }), el('div', { class: 'skeleton', style: 'width:70%' })));

  const section = el('section', { class: 'stack' });
  try {
    let mod;
    try {
      mod = await import(`./modules/${route.module}.js`);
    } catch (e) {
      console.error(`Module "${route.module}" failed to load`, e);
      if (my === token) view.replaceChildren(notice(route.title, `This module is not available yet (planned for Phase ${route.phase}).`));
      return;
    }
    await mod.render(section, { ...ctx, params, route });
    if (my !== token) { mod.destroy?.(); return; }
    current = mod;
    view.replaceChildren(section);
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    if (my === token) view.replaceChildren(notice('Something went wrong', 'This page could not be loaded. Try again or reload.'));
  }
}

function setTitle(t) {
  document.getElementById('page-title').textContent = t;
  document.title = `${t} · AHBA QA & Training`;
}

export function startRouter(ctx) {
  stopRouter();
  listener = () => go(ctx);
  window.addEventListener('hashchange', listener);
  go(ctx);
}

export function stopRouter() {
  if (listener) window.removeEventListener('hashchange', listener);
  listener = null; token++;
  if (current?.destroy) { try { current.destroy(); } catch { /* ignore */ } }
  current = null;
}
