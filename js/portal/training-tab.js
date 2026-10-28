import { el } from '../utils/dom.js';
import { errorState } from '../ui/states.js';
import { friendlyError } from '../utils/errors.js';
import { fmtDate } from '../utils/dates.js';
import { getPortal } from './data.js';
import { syncBanner } from './chrome.js';

// Read-only employee training data. All rows come from the server-filtered v_my_training view.
export async function renderTraining(root, ctx) {
  let d;
  try { d = await getPortal(ctx); }
  catch (e) { root.append(errorState(friendlyError(e), () => location.reload())); return; }
  root.append(syncBanner(d));
  const rows = d.training;
  if (rows === null || rows === undefined) {
    root.append(el('section', { class: 'card' },
      el('h2', {}, 'My Training'),
      el('p', { class: 'muted' }, 'Training progress is not enabled yet. An administrator must review and apply migration 013.')));
    return;
  }
  const required = rows.filter(r => r.required);
  const complete = required.filter(r => r.completed_on).length;
  const pct = required.length ? Math.round(complete / required.length * 100) : 0;
  root.append(
    el('header', { class: 'portal-welcome' },
      el('span', { class: 'eyebrow' }, 'PERSONAL LEARNING RECORD'),
      el('h2', {}, 'My Training'),
      el('p', { class: 'muted' }, 'Your training progress and completion history. Read-only.')),
    el('section', { class: 'card portal-card' },
      el('div', { class: 'row', style: 'justify-content:space-between;align-items:center' },
        el('strong', {}, 'Required training completion'), el('strong', {}, required.length ? pct + '%' : 'Not configured')),
      el('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100', style: 'margin-top:12px' },
        el('span', { style: 'width:' + pct + '%' })),
      el('p', { class: 'small muted', style: 'margin-top:10px' }, complete + ' of ' + required.length + ' required trainings completed')),
    el('div', { class: 'stack' }, rows.length
      ? rows.map(r => el('article', { class: 'card portal-card' },
          el('div', { class: 'row', style: 'justify-content:space-between' },
            el('h3', { class: 'portal-card__title' }, r.name),
            el('span', { class: 'badge ' + (r.completed_on ? 'badge--green' : 'badge--amber') },
              r.completed_on ? 'Completed' : 'Pending')),
          el('p', { class: 'small muted' }, r.required ? 'Required training' : 'Optional training'),
          r.completed_on ? el('p', {}, 'Completed: ' + fmtDate(r.completed_on)) : null))
      : el('section', { class: 'card' }, el('p', { class: 'muted' }, 'No training types have been configured.'))));
}
