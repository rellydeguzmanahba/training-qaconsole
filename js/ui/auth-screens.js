import { el } from '../utils/dom.js';
import { guarded } from '../utils/submit.js';

const brand = () => el('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'A');

function logoScene() {
  const stage = el('div', { class: 'login-logo-stage' });
  const canvas = el('canvas', { class: 'login-three-canvas', 'aria-hidden': 'true' });
  const fallback = el('img', { src: 'assets/images/ahba-training-qa-official.png', alt: 'AHBA Development — Training & QA', class: 'login-logo-fallback-image', draggable: 'false', hidden: true });
  const subtitle = el('div', { class: 'login-qa-subtitle' });
  'Training & QA'.split('').forEach((letter, index) => {
    const span = el('span', { class: 'login-qa-letter' }, letter === ' ' ? '\u00a0' : letter);
    span.style.setProperty('--letter', index);
    subtitle.append(span);
  });
  stage.append(canvas, fallback, subtitle);
  const showFallback = () => { canvas.hidden = true; subtitle.hidden = true; fallback.hidden = false; };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    showFallback();
  } else {
    const load = () => import('../login/corporate-3d.js').then(({ startCorporateLogo }) => {
      if (!stage.isConnected) return;
      startCorporateLogo(canvas);
    }).catch(error => { console.warn('Corporate 3D unavailable:', error); showFallback(); });
    if (window.THREE) load();
    else {
      const library = document.createElement('script');
      library.src = 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js';
      library.onload = load;
      library.onerror = showFallback;
      document.head.append(library);
    }
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
