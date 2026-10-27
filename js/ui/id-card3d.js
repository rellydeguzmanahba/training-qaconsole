// Animated employee ID on a lanyard: CSS 3D transforms + a tiny physics loop (no WebGL; light enough for low-end phones).
// Descends, swings and settles (damped pendulum + lagging card), tilts toward the pointer, flips on click/Enter/Space.
// Reduced motion: static card, flip swaps faces. A frame-time guard switches to a lite mode on slow devices.
import { el } from '../utils/dom.js';

export const stepPendulum = (s, dt, k = 4.4, c = 1.1) => { s.omega += (-k * Math.sin(s.theta) - c * s.omega) * dt; s.theta += s.omega * dt; return s; };
export const stepSpring = (s, target, dt, k = 180, c = 18) => { s.v += (-k * (s.x - target) - c * s.v) * dt; s.x += s.v * dt; return s; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const svgNS = 'http://www.w3.org/2000/svg';

function lanyard() {
  const s = document.createElementNS(svgNS, 'svg');
  s.setAttribute('viewBox', '0 0 260 170'); s.setAttribute('class', 'idc__lanyard'); s.setAttribute('aria-hidden', 'true');
  const mk = (tag, a) => { const n = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); return n; };
  s.append(mk('polygon', { points: '26,0 62,0 146,160 118,160', fill: '#0f7a52' }), mk('polygon', { points: '198,0 234,0 142,160 114,160', fill: '#0b6244' }),
    mk('line', { x1: 44, y1: 0, x2: 132, y2: 160, stroke: '#b8963e', 'stroke-width': 1.4, 'stroke-dasharray': '5 4' }),
    mk('line', { x1: 216, y1: 0, x2: 128, y2: 160, stroke: '#b8963e', 'stroke-width': 1.4, 'stroke-dasharray': '5 4' }));
  return s;
}

// data: { name, initials, designation, company, status, employeeNo, since }
export function mountIdCard(host, data, { logoUrl = null } = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const row = (k, v) => el('div', { class: 'idc__row' }, el('span', {}, k), el('strong', {}, v || '—'));
  const front = el('div', { class: 'idc__face idc__front' },
    el('span', { class: 'idc__slot', 'aria-hidden': 'true' }),
    logoUrl ? el('img', { class: 'idc__logo', src: logoUrl, alt: 'AHBA Development Training & QA', draggable: 'false' }) : el('div', { class: 'idc__wordmark' }, 'AHBA Development · Training & QA'),
    el('div', { class: 'idc__label' }, 'Employee ID'),
    el('div', { class: 'idc__avatar', 'aria-hidden': 'true' }, data.initials),
    el('h3', { class: 'idc__name' }, data.name),
    el('div', { class: 'idc__role' }, data.designation || ''),
    el('div', { class: 'idc__company' }, data.company || ''),
    el('div', { class: 'idc__band' }, el('span', {}, data.employeeNo ? `ID ${data.employeeNo}` : 'ID not yet assigned'), el('span', { class: 'idc__status' }, data.status || '')),
    el('span', { class: 'idc__glare', 'aria-hidden': 'true' }));
  const back = el('div', { class: 'idc__face idc__back' },
    el('div', { class: 'idc__stripe', 'aria-hidden': 'true' }),
    el('div', { class: 'idc__rows' }, row('Name', data.name), row('Company', data.company), row('Designation', data.designation),
      row('Status', data.status), row('Employee since', data.since), row('Employee no.', data.employeeNo)),
    el('div', { class: 'idc__foot' }, 'AHBA Development · Training & QA'), el('span', { class: 'idc__glare', 'aria-hidden': 'true' }));
  const card = el('div', { class: 'idc__card', role: 'button', tabindex: '0', 'aria-pressed': 'false',
    'aria-label': `Employee ID card for ${data.name}. Activate to flip it over.` }, front, back);
  const pivot = el('div', { class: 'idc__pivot' }, card);
  const swing = el('div', { class: 'idc__swing' }, lanyard(), el('span', { class: 'idc__clip', 'aria-hidden': 'true' }), pivot);
  const stage = el('div', { class: `idc${reduced ? ' is-static' : ''}` }, el('div', { class: 'idc__drop' }, swing));
  host.replaceChildren(stage);

  let flipped = false;
  const setFlip = (v) => { flipped = v; card.setAttribute('aria-pressed', String(v)); stage.classList.toggle('is-flipped', v); if (!reduced) kick(); };
  if (reduced) { card.addEventListener('click', () => setFlip(!flipped)); card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFlip(!flipped); } }); return { destroy() { host.replaceChildren(); } }; }

  // ---- physics state
  const P = { theta: 0.38, omega: 0 }, L = { x: 0.38, v: 0 }, F = { x: 0, v: 0 }, TX = { x: 0, v: 0 }, TY = { x: 0, v: 0 };
  let tgtX = 0, tgtY = 0, raf = 0, last = 0, lite = false, slow = 0, frames = 0, lastImpulse = 0, down = null, lx = 0, lt = 0;
  const settled = () => Math.abs(P.theta) < 0.002 && Math.abs(P.omega) < 0.004 && Math.abs(L.x - P.theta) < 0.002 && Math.abs(L.v) < 0.004
    && Math.abs(F.x - (flipped ? 1 : 0)) < 0.002 && Math.abs(F.v) < 0.01 && Math.abs(TX.x - tgtX) < 0.05 && Math.abs(TY.x - tgtY) < 0.05;

  const apply = () => {
    swing.style.transform = `rotate(${P.theta}rad)`;
    pivot.style.transform = `rotate(${L.x - P.theta}rad)`;
    card.style.transform = `rotateY(${F.x * 180 + TY.x}deg) rotateX(${TX.x}deg)`;
  };
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const raw = (now - last) / 1000 || 0.016, dt = Math.min(1 / 30, raw); last = now;
    if (++frames <= 90 && raw > 0.034) slow++;                 // measured before clamping: sustained <30 fps => lite mode
    if (slow > 30 && !lite) { lite = true; stage.classList.add('is-lite'); P.theta = P.omega = L.x = L.v = 0; }
    const steps = dt > 1 / 50 ? 2 : 1, h = dt / steps;
    for (let i = 0; i < steps; i++) {
      if (!lite) { stepPendulum(P, h); stepSpring(L, P.theta, h, 38, 7); stepSpring(TX, tgtX, h, 120, 16); stepSpring(TY, tgtY, h, 120, 16); }
      stepSpring(F, flipped ? 1 : 0, h);
    }
    apply();
    if (settled()) { cancelAnimationFrame(raf); raf = 0; }
  };
  function kick() { if (!raf && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  // ---- interaction
  const onMove = (e) => {
    const r = card.getBoundingClientRect();
    const nx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2), -1, 1), ny = clamp((e.clientY - (r.top + r.height / 2)) / (r.height / 2), -1, 1);
    if (!lite) { tgtY = nx * 16; tgtX = -ny * 14; }
    stage.style.setProperty('--gx', `${50 + nx * 40}%`); stage.style.setProperty('--gy', `${50 + ny * 40}%`);
    const now = performance.now(), vx = (e.clientX - lx) / Math.max(1, now - lt) * 1000;
    if (!lite && Math.abs(vx) > 450 && now - lastImpulse > 140) { P.omega += clamp(vx / 1800, -0.6, 0.6) * 0.5; lastImpulse = now; }
    lx = e.clientX; lt = now; kick();
  };
  const onLeave = () => { tgtX = tgtY = 0; kick(); };
  card.addEventListener('pointermove', onMove);
  card.addEventListener('pointerenter', (e) => { lx = e.clientX; lt = performance.now(); });
  card.addEventListener('pointerleave', onLeave);
  card.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  card.addEventListener('pointerup', (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && performance.now() - down.t < 600) setFlip(!flipped);
    down = null; if (e.pointerType !== 'mouse') onLeave();
  });
  card.addEventListener('pointercancel', () => { down = null; onLeave(); });
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFlip(!flipped); } });
  const onVis = () => (document.hidden ? (cancelAnimationFrame(raf), raf = 0) : kick());
  document.addEventListener('visibilitychange', onVis);
  apply(); kick();
  return { destroy() { cancelAnimationFrame(raf); raf = 0; document.removeEventListener('visibilitychange', onVis); host.replaceChildren(); } };
}
