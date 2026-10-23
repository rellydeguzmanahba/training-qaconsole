import { el } from '../utils/dom.js';

// Generic modal. `body` is a DOM node. Resolves with the value of the clicked action (or null on cancel/Esc).
export function showModal({ title, body, actions }) {
  return new Promise((resolve) => {
    const dlg = el('dialog', { class: 'modal', 'aria-label': title });
    const buttons = actions.map((a) => el('button', {
      type: 'button', class: `btn ${a.class || ''}`,
      onclick: () => dlg.close(a.value),
    }, a.label));
    dlg.append(el('div', { class: 'modal__body' }, el('h2', {}, title), body), el('div', { class: 'modal__actions' }, buttons));
    dlg.addEventListener('close', () => { const v = dlg.returnValue || null; dlg.remove(); resolve(v === '' ? null : v); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export async function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Confirm', danger = false }) {
  const v = await showModal({
    title,
    body: el('p', { class: 'muted' }, message),
    actions: [
      { label: 'Cancel', value: 'cancel' },
      { label: confirmText, value: 'ok', class: danger ? 'btn--danger' : 'btn--primary' },
    ],
  });
  return v === 'ok';
}
