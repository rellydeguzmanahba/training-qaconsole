import { el } from '../utils/dom.js';

let seq = 0;
// Generic modal. `body` is a DOM node. Resolves with the clicked action's value (or null on cancel/Esc).
// focusIndex: which action button gets initial focus (defaults to the last = primary action).
export function showModal({ title, body, actions, focusIndex = actions.length - 1 }) {
  return new Promise((resolve) => {
    const id = `dlg-title-${++seq}`;
    const dlg = el('dialog', { class: 'modal', 'aria-labelledby': id });
    const buttons = actions.map((a) => el('button', { type: 'button', class: `btn ${a.class || ''}`, onclick: () => dlg.close(a.value) }, a.label));
    dlg.append(el('div', { class: 'modal__body' }, el('h2', { id }, title), body), el('div', { class: 'modal__actions' }, buttons));
    const opener = document.activeElement;
    dlg.addEventListener('close', () => { const v = dlg.returnValue || null; dlg.remove(); opener?.focus?.(); resolve(v === '' ? null : v); });
    document.body.append(dlg);
    dlg.showModal();
    buttons[focusIndex]?.focus();
  });
}

export async function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Confirm', danger = false }) {
  const v = await showModal({
    title, body: el('p', { class: 'muted' }, message),
    focusIndex: danger ? 0 : 1,                                   // destructive actions default to Cancel
    actions: [{ label: 'Cancel', value: 'cancel' }, { label: confirmText, value: 'ok', class: danger ? 'btn--danger' : 'btn--primary' }],
  });
  return v === 'ok';
}
