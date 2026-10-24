import { el } from '../utils/dom.js';
import { guarded } from '../utils/submit.js';

const brand = () => el('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'A');

function logoScene() {
  // Exact logo artwork, not a reconstructed 3D model.
  const logo = el('img', {
    src: 'assets/images/ahba-training-qa-logo.webp',
    alt: 'AHBA Development — Training & QA',
    class: 'login-logo',
    draggable: 'false',
    decoding: 'async'
  });
  return el('div', { class: 'login-logo-stage' }, logo);
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
