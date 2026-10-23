import { el } from '../utils/dom.js';
import { guarded } from '../utils/submit.js';

const brand = () => el('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'A');

export function renderLogin(root, { onSubmit }) {
  const err = el('div', { class: 'alert alert--error', role: 'alert', hidden: true });
  const email = el('input', { id: 'email', class: 'input', type: 'email', autocomplete: 'username', required: true, maxlength: 254 });
  const pass = el('input', { id: 'password', class: 'input', type: 'password', autocomplete: 'current-password', required: true, maxlength: 128 });
  const btn = el('button', { class: 'btn btn--primary', type: 'submit', style: 'width:100%' }, 'Sign in');

  const form = el('form', { novalidate: true },
    err,
    el('div', { class: 'field' }, el('label', { for: 'email' }, 'Email'), email),
    el('div', { class: 'field' }, el('label', { for: 'password' }, 'Password'), pass),
    btn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.hidden = true;
    if (!email.value.trim() || !pass.value) { err.textContent = 'Enter your email and password.'; err.hidden = false; return; }
    guarded(btn, async () => {
      const msg = await onSubmit(email.value.trim(), pass.value);
      if (msg) { err.textContent = msg; err.hidden = false; pass.value = ''; pass.focus(); }
    });
  });

  root.replaceChildren(el('div', { class: 'auth-card' },
    brand(), el('h2', {}, 'AHBA QA & Training'), el('p', { class: 'muted', style: 'margin:4px 0 20px' }, 'Sign in to continue.'), form));
  email.focus();
}

export function renderNotice(root, { title, message, actions = [] }) {
  root.replaceChildren(el('div', { class: 'auth-card' },
    brand(), el('h2', {}, title), el('p', { class: 'muted', style: 'margin:8px 0 20px' }, message),
    el('div', { class: 'row' }, actions.map((a) => el('button', { class: `btn ${a.class || ''}`, type: 'button', onclick: a.onClick }, a.label)))));
}
