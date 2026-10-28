import { el } from '../utils/dom.js';
import { dataTable } from '../ui/table.js';
import { badge, EMPLOYMENT_VARIANT, deploymentVariant } from '../ui/badge.js';
import { fetchAll } from '../utils/db.js';
import { friendlyError } from '../utils/errors.js';
import { openTechnicianForm, STATUSES } from './technician-form.js';

const fullName = (t) => [t.first_name, t.middle_name, t.surname].filter(Boolean).join(' ');

export async function render(root, ctx) {
  if (ctx.params[0]) {                       // #/technicians/<id>
    const { renderDetail } = await import('./technician-detail.js');
    return renderDetail(root, ctx, ctx.params[0]);
  }
  await renderList(root, ctx);
}

async function renderList(root, ctx) {
  const { sb } = ctx;
  let data;
  try {
    const [techs, types, recs, status, co, de] = await Promise.all([
      fetchAll(() => sb.from('technicians')
        .select('id,first_name,middle_name,surname,birthdate,date_hired,mobile,email,employment_status,date_separated,separation_reason,lms_user,lms_login,company_id,designation_id,version,company:companies(name),designation:designations(name),technician_access(access_id)')
        .order('surname').order('first_name').order('id')),
      sb.from('training_types').select('id').eq('active', true).eq('required', true),
      fetchAll(() => sb.from('training_records').select('id,technician_id,training_type_id').order('id')),
      fetchAll(() => sb.from('v_offense_status').select('technician_id,monitoring_status,deployment_status').order('technician_id')),
      sb.from('companies').select('id,name').eq('active', true).order('name'),
      sb.from('designations').select('id,name').eq('active', true).order('name'),
    ]);
    for (const r of [types, co, de]) if (r.error) throw r.error;
    data = { techs, required: new Set(types.data.map((t) => t.id)), recs, status, companies: co.data, designations: de.data };
  } catch (e) {
    console.error(e);
    root.append(el('div', { class: 'alert alert--error' }, friendlyError(e),
      ' ', el('button', { class: 'btn btn--sm', type: 'button', onclick: () => location.reload() }, 'Retry')));
    return;
  }

  // training progress per technician (distinct required types completed)
  const done = new Map();
  for (const r of data.recs) {
    if (!data.required.has(r.training_type_id)) continue;
    if (!done.has(r.technician_id)) done.set(r.technician_id, new Set());
    done.get(r.technician_id).add(r.training_type_id);
  }
  const statusBy = new Map(data.status.map((s) => [s.technician_id, s]));
  const total = data.required.size;
  const rows = data.techs.map((t) => ({
    ...t, name: fullName(t), access: t.technician_access.map((a) => a.access_id),
    company_name: t.company?.name ?? '', designation_name: t.designation?.name ?? '',
    done: done.get(t.id)?.size ?? 0, offense: statusBy.get(t.id) ?? null,
  }));

  const search = el('input', { class: 'input', type: 'search', placeholder: 'Search name, email, mobile…', 'aria-label': 'Search technicians' });
  const sel = (label, items, val = (x) => x.id, txt = (x) => x.name) => {
    const s = el('select', { class: 'input', 'aria-label': label }, el('option', { value: '' }, `All ${label.toLowerCase()}`));
    for (const i of items) s.append(el('option', { value: String(val(i)) }, txt(i)));
    return s;
  };
  const fCompany = sel('Companies', data.companies);
  const fDesig = sel('Designations', data.designations);
  const fStatus = sel('Statuses', STATUSES, (x) => x, (x) => x);
  const count = el('span', { class: 'muted small' });

  const columns = [
    { key: 'name', label: 'Technician', render: (r) => el('a', { href: `#/technicians/${r.id}`, class: 'employee-peek-trigger', 'data-employee-id': String(r.id), 'aria-label': `View ${r.name} details`, title: 'Hover for quick details; click for full profile' }, r.name) },
    { key: 'company_name', label: 'Company' },
    { key: 'designation_name', label: 'Designation' },
    { key: 'employment_status', label: 'Status', render: (r) => badge(r.employment_status, EMPLOYMENT_VARIANT[r.employment_status]) },
    { key: 'contact', label: 'Contact', sort: (r) => r.mobile || r.email || '',
      render: (r) => el('div', {}, r.mobile || '', r.mobile && r.email ? el('br') : null, r.email ? el('span', { class: 'muted small' }, r.email) : null) },
    { key: 'done', label: 'Training', render: (r) => badge(`${r.done}/${total}`, total && r.done >= total ? 'green' : r.done ? 'blue' : 'amber') },
    { key: 'deploy', label: 'Deployment', sort: (r) => r.offense?.deployment_status ?? '',
      render: (r) => (r.offense ? badge(r.offense.deployment_status, deploymentVariant(r.offense.deployment_status)) : '—') },
  ];
  const table = dataTable({ columns, rows, pageSize: 25, initialSort: { key: 'name' }, empty: 'No technicians match your filters.' });
  // Lightweight accessible quick-view: no additional requests or personal-data caching.
  // Only fields already authorized and loaded for the current technician directory are displayed.
  const peek = el('section', { class: 'employee-peek', role: 'tooltip', hidden: true });
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  let activeTrigger = null;
  const field = (label, value) => el('div', { class: 'employee-peek__field' },
    el('span', { class: 'employee-peek__label' }, label),
    el('strong', {}, value == null || value === '' ? '—' : String(value)));
  const positionPeek = (trigger) => {
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 24);
    peek.style.width = `${width}px`;
    const height = peek.offsetHeight;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const top = rect.bottom + height + 12 <= window.innerHeight ? rect.bottom + 8 : Math.max(12, rect.top - height - 8);
    peek.style.left = `${left}px`;
    peek.style.top = `${top}px`;
  };
  const showPeek = (trigger) => {
    const row = byId.get(trigger.dataset.employeeId);
    if (!row) return;
    activeTrigger = trigger;
    peek.replaceChildren(
      el('div', { class: 'employee-peek__heading' },
        el('span', { class: 'employee-peek__avatar', 'aria-hidden': 'true' }, (row.first_name?.[0] || 'A') + (row.surname?.[0] || 'H')),
        el('div', {}, el('strong', { class: 'employee-peek__name' }, row.name),
          el('span', { class: 'employee-peek__sub' }, row.designation_name || 'Technician'))),
      el('div', { class: 'employee-peek__grid' },
        field('Company', row.company_name), field('Employment', row.employment_status),
        field('Training', `${row.done}/${total}`), field('Deployment', row.offense?.deployment_status),
        field('Date hired', row.date_hired), field('Mobile', row.mobile)),
      el('span', { class: 'employee-peek__hint' }, 'Click the name to open the complete profile')
    );
    peek.hidden = false;
    positionPeek(trigger);
  };
  const hidePeek = () => { activeTrigger = null; peek.hidden = true; };
  table.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const trigger = event.target.closest?.('.employee-peek-trigger');
    if (trigger && trigger !== activeTrigger) showPeek(trigger);
  });
  table.addEventListener('pointerout', (event) => {
    if (activeTrigger && !activeTrigger.contains(event.relatedTarget)) hidePeek();
  });
  table.addEventListener('focusin', (event) => {
    const trigger = event.target.closest?.('.employee-peek-trigger');
    if (trigger) showPeek(trigger);
  });
  table.addEventListener('focusout', (event) => {
    if (activeTrigger && !activeTrigger.contains(event.relatedTarget)) hidePeek();
  });
  table.addEventListener('click', (event) => {
    // On touch devices the first tap shows the card; the next tap opens the profile.
    const trigger = event.target.closest?.('.employee-peek-trigger');
    if (trigger && matchMedia('(hover: none)').matches && activeTrigger !== trigger) {
      event.preventDefault(); showPeek(trigger);
    }
  });
  const dismiss = (event) => { if (event.key === 'Escape') hidePeek(); };
  table.addEventListener('keydown', dismiss);
  table.addEventListener('scroll', hidePeek, true);


  const apply = () => {
    const q = search.value.trim().toLowerCase();
    const list = rows.filter((r) =>
      (!q || [r.name, r.email, r.mobile].some((x) => String(x ?? '').toLowerCase().includes(q))) &&
      (!fCompany.value || String(r.company_id) === fCompany.value) &&
      (!fDesig.value || String(r.designation_id) === fDesig.value) &&
      (!fStatus.value || r.employment_status === fStatus.value));
    table.setRows(list);
    count.textContent = `${list.length} of ${rows.length}`;
  };
  [search, fCompany, fDesig, fStatus].forEach((n) => n.addEventListener('input', apply));

  const add = async () => {
    const saved = await openTechnicianForm(ctx, null);
    if (saved) { ctx.toast('Technician added.', 'success'); root.replaceChildren(); await renderList(root, ctx); }
  };

  root.append(
    el('div', { class: 'page-head' }, el('div', {}, el('h2', {}, 'Technicians'), count),
      ctx.can('technicians:write') ? el('button', { class: 'btn btn--primary', type: 'button', onclick: add }, 'Add technician') : null),
    el('div', { class: 'toolbar' }, search, fCompany, fDesig, fStatus,
      el('button', { class: 'btn', type: 'button', onclick: () => { search.value = ''; fCompany.value = fDesig.value = fStatus.value = ''; apply(); } }, 'Reset')),
    el('div', { class: 'card card--flush' }, table), peek);
  apply();
}
