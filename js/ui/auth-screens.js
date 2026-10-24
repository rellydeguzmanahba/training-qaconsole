import { el } from '../utils/dom.js';
import { guarded } from '../utils/submit.js';

const brand = () => el('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'A');

function logoScene() {
  const stage = el('div', { class: 'login-logo-stage' });
  const inner = el('div', { class: 'login-logo-inner' });
  // Inline SVG has a transparent background. The green shapes animate individually.
  // The geometry is a stylized approximation of the corporate logo, not its source vector.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'login-logo-svg');
  svg.setAttribute('viewBox', '0 0 900 510');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'AHBA Development — Training and QA');
  svg.innerHTML = `
    <defs>
      <linearGradient id="ahbaGreen" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#0a7a1d"/><stop offset=".5" stop-color="#1eb13a"/><stop offset="1" stop-color="#076a20"/></linearGradient>
    </defs>
    <g class="login-mark" fill="none" stroke="url(#ahbaGreen)" stroke-linecap="round" stroke-linejoin="round">
      <path class="login-a-left" d="M190 345 C205 266 247 159 310 95" stroke-width="49"/>
      <path class="login-a-right" d="M309 95 C368 174 402 252 413 346" stroke-width="52"/>
      <path class="login-arch" d="M340 384 C481 369 618 288 654 183 C691 71 557 61 448 116 C399 140 361 172 326 207" stroke-width="38"/>
      <path class="login-arch-secondary" d="M373 391 C522 355 650 260 670 174" stroke-width="13"/>
      <path class="login-arrow" d="M340 207 L170 361 M170 361 L191 309 M170 361 L223 344" stroke-width="15"/>
    </g>
    <text class="login-wordmark" x="450" y="282" text-anchor="middle">AHBA <tspan font-size="66">Development</tspan></text>
    <text class="login-subtitle" x="450" y="465" text-anchor="middle">TRAINING &amp; QA</text>
  `;
  inner.appendChild(svg);
  stage.appendChild(inner);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    let frame = 0, rx = 0, ry = 0, tx = 0, ty = 0;
    function animate() {
      rx += (tx - rx) * .11;
      ry += (ty - ry) * .11;
      inner.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      if (Math.abs(tx - rx) + Math.abs(ty - ry) > .03) frame = requestAnimationFrame(animate);
      else frame = 0;
    }
    function update() { if (!frame) frame = requestAnimationFrame(animate); }
    stage.addEventListener('pointermove', event => {
      const r = stage.getBoundingClientRect();
      tx = -((event.clientY - r.top) / r.height - .5) * 9;
      ty = ((event.clientX - r.left) / r.width - .5) * 12;
      update();
    });
    stage.addEventListener('pointerleave', () => { tx = 0; ty = 0; update(); });
  }
  return stage;
}

export function renderLogin(root, { onSubmit }) {
  const err = el('div', { class: 'alert alert--error', role: 'alert', hidden: true });
  const email = el('input', { id: 'email', class: 'input', type: 'email', autocomplete: 'username', required: true, maxlength: 254, placeholder: 'you@company.com' });
  const pass = el('input', { id: 'password', class: 'input', type: 'password', autocomplete: 'current-password', required: true, maxlength: 128, placeholder: 'Enter your password' });
  const btn = el('button', { class: 'btn btn--primary login-submit', type: 'submit' }, 'Sign in');
  const form = el('form', { novalidate: true, class: 'login-form' },
    err,
    el('div', { class: 'field' }, el('label', { for: 'email' }, 'Email address'), email),
    el('div', { class: 'field' }, el('label', { for: 'password' }, 'Password'), pass),
    btn);
  form.addEventListener('submit', (e) => {
    e.preventDefault(); err.hidden = true;
    if (!email.value.trim() || !pass.value) { err.textContent = 'Enter your email and password.'; err.hidden = false; return; }
    guarded(btn, async () => {
      const msg = await onSubmit(email.value.trim(), pass.value);
      if (msg) { err.textContent = msg; err.hidden = false; pass.value = ''; pass.focus(); }
    });
  });
  root.replaceChildren(el('section', { class: 'login-shell' },
    el('div', { class: 'login-visual' }, logoScene(), el('p', { class: 'login-visual-note' }, 'Training • Quality Assurance • Continuous Improvement')),
    el('div', { class: 'login-panel' },
      el('div', { class: 'login-panel-inner' },
        el('div', { class: 'login-eyebrow' }, 'AHBA DEVELOPMENT'),
        el('h1', { class: 'login-heading' }, 'Welcome back'),
        el('p', { class: 'login-description' }, 'Sign in to your Training & QA workspace.'),
        form,
        el('p', { class: 'login-help' }, 'Authorized personnel only. Contact your administrator if you need access.')
      )
    )
  ));
  email.focus();
}

export function renderNotice(root, { title, message, actions = [] }) {
  root.replaceChildren(el('div', { class: 'auth-card' },
    brand(), el('h2', {}, title), el('p', { class: 'muted', style: 'margin:8px 0 20px' }, message),
    el('div', { class: 'row' }, actions.map((a) => el('button', { class: `btn ${a.class || ''}`, type: 'button', onclick: a.onClick }, a.label)))));
}
