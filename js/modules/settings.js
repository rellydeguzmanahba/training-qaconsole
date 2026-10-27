import { el } from '../utils/dom.js';
import { errorState } from '../ui/states.js';
import { dataTable } from '../ui/table.js';
import { formModal } from '../ui/form.js';
import { badge } from '../ui/badge.js';
import { updateVersioned, updateVersionedBy, fetchAll } from '../utils/db.js';
import { friendlyError } from '../utils/errors.js';
import { fmtDateTime } from '../utils/dates.js';
import { ordinal } from '../utils/validate.js';

const NAME_FIELD = { name: 'name', label: 'Name', type: 'text', required: true, maxlength: 120 };

const LOOKUPS = {
  companies:       { label: 'Companies', table: 'companies', order: 'name', fields: [NAME_FIELD], cols: [{ key: 'name', label: 'Name' }] },
  designations:    { label: 'Designations', table: 'designations', order: 'name', fields: [NAME_FIELD], cols: [{ key: 'name', label: 'Name' }] },
  access_systems:  { label: 'Access systems', table: 'access_systems', order: 'name', fields: [NAME_FIELD], cols: [{ key: 'name', label: 'Name' }] },
  training_types:  { label: 'Training types', table: 'training_types', order: 'sort_order',
    fields: [NAME_FIELD,
      { name: 'required', label: 'Required (counts toward completion and missing-training checks)', type: 'checkbox' },
      { name: 'sort_order', label: 'Sort order', type: 'number', min: 0, max: 9999, step: 1 }],
    defaults: { required: true, sort_order: 0 },
    cols: [{ key: 'name', label: 'Name' },
      { key: 'required', label: 'Required', render: (r) => badge(r.required ? 'Required' : 'Optional', r.required ? 'green' : '') },
      { key: 'sort_order', label: 'Order' }] },
  violation_categories: { label: 'Violation categories', table: 'violation_categories', order: 'code',
    fields: [{ name: 'code', label: 'Code', type: 'text', required: true, maxlength: 40 },
      { name: 'name', label: 'Description', type: 'text', required: true, maxlength: 250 }],
    cols: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Description' }] },
  action_types:    { label: 'Action types', table: 'action_types', order: 'name', versioned: false, fields: [NAME_FIELD], cols: [{ key: 'name', label: 'Name' }] },
};

const TABS = [...Object.entries(LOOKUPS).map(([k, v]) => ({ id: k, label: v.label })),
  { id: 'penalty', label: 'Penalty rules' }, { id: 'monitoring', label: 'Monitoring period' }, { id: 'users', label: 'Users' }, { id: 'tech-accounts', label: 'Technician accounts' }];

export async function render(root, ctx) {
  const content = el('div');
  const tabs = el('div', { class: 'tabs', role: 'tablist' });
  const show = async (id) => {
    tabs.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.id === id)));
    content.replaceChildren(el('div', { class: 'skeleton' }));
    try {
      const host = el('div');
      if (LOOKUPS[id]) await renderLookup(host, ctx, LOOKUPS[id]);
      else if (id === 'penalty') await renderPenalty(host, ctx);
      else if (id === 'monitoring') await renderMonitoring(host, ctx);
      else if (id === 'tech-accounts') await (await import('./technician-accounts.js')).renderAccounts(host, ctx);
      else await renderUsers(host, ctx);
      content.replaceChildren(host);
    } catch (e) {
      console.error(e);
      content.replaceChildren(errorState(friendlyError(e), () => show(id)));
    }
  };
  for (const t of TABS) tabs.append(el('button', { class: 'tab', type: 'button', role: 'tab', dataset: { id: t.id }, onclick: () => show(t.id) }, t.label));
  root.append(el('div', { class: 'page-head' }, el('div', {}, el('h2', {}, 'Settings'),
    el('p', { class: 'muted small' }, 'Changes apply immediately. Items are deactivated, never deleted, so historical records stay intact.'))),
    tabs, content);
  await show(TABS[0].id);
}

// ---------- generic lookup manager ----------
async function renderLookup(host, ctx, cfg) {
  const rows = await fetchAll(() => ctx.sb.from(cfg.table).select('*').order(cfg.order).order('id'));
  const reload = async () => { const h = el('div'); await renderLookup(h, ctx, cfg); host.replaceChildren(...h.childNodes); };
  const versioned = cfg.versioned !== false;

  const save = async (row, vals) => {
    if (row) {
      if (versioned) await updateVersioned(ctx.sb, cfg.table, row.id, row.version, vals);
      else { const { error } = await ctx.sb.from(cfg.table).update(vals).eq('id', row.id); if (error) throw error; }
    } else {
      const { error } = await ctx.sb.from(cfg.table).insert(vals); if (error) throw error;
    }
  };
  const edit = async (row) => {
    const r = await formModal({ title: row ? `Edit ${cfg.label.toLowerCase()}` : `Add to ${cfg.label.toLowerCase()}`,
      fields: cfg.fields, values: row || cfg.defaults || {}, onSubmit: (v) => save(row, v) });
    if (r) { ctx.toast('Saved.', 'success'); await reload(); }
  };
  const toggle = async (row) => {
    if (row.active && !(await ctx.confirm({ title: 'Deactivate this item?',
      message: 'It will no longer appear in dropdowns. Existing records keep it.', confirmText: 'Deactivate', danger: true }))) return;
    try { await save(row, { active: !row.active }); ctx.toast(row.active ? 'Deactivated.' : 'Activated.', 'success'); await reload(); }
    catch (e) { ctx.toast(friendlyError(e), 'error'); }
  };

  const columns = [...cfg.cols,
    { key: 'active', label: 'Status', render: (r) => badge(r.active ? 'Active' : 'Inactive', r.active ? 'green' : '') },
    { key: 'actions', label: '', nosort: true, render: (r) => el('div', { class: 'cell-actions' },
      el('button', { class: 'btn btn--sm', type: 'button', onclick: () => edit(r) }, 'Edit'),
      el('button', { class: 'btn btn--sm', type: 'button', onclick: () => toggle(r) }, r.active ? 'Deactivate' : 'Activate')) }];

  const table = dataTable({ columns, rows, pageSize: 30, initialSort: { key: cfg.cols[0].key } });
  const search = el('input', { class: 'input', type: 'search', placeholder: 'Search…', 'aria-label': 'Search' });
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    table.setRows(q ? rows.filter((r) => cfg.cols.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q))) : rows);
  });
  host.replaceChildren(el('div', { class: 'toolbar' }, search,
    el('button', { class: 'btn btn--primary', type: 'button', onclick: () => edit(null) }, `Add`)),
    el('div', { class: 'card card--flush' }, table));
}

// Offense rules changed -> refresh engine proposals.
async function recalc(ctx) {
  const { error } = await ctx.sb.rpc('recalculate_offenses', { p_technician: null });
  if (error) ctx.toast(`Saved, but offense recalculation failed: ${friendlyError(error)}`, 'error');
}

// ---------- penalty rules ----------
async function renderPenalty(host, ctx) {
  const { data: rows, error } = await ctx.sb.from('penalty_rules').select('*').order('offense_no').order('severity_group');
  if (error) throw error;
  const edit = async (r) => {
    const res = await formModal({ title: `${ordinal(r.offense_no)} offense – ${r.severity_group}`,
      fields: [{ name: 'penalty', label: 'Penalty', type: 'text', required: true, maxlength: 300 },
        { name: 'hold_days', label: 'Deployment hold (days)', type: 'number', required: true, min: 0, max: 365, step: 1,
          hint: 'Counted from the offense date. Holds and bans need supervisor approval.' }],
      values: r,
      onSubmit: (v) => updateVersionedBy(ctx.sb, 'penalty_rules', { offense_no: r.offense_no, severity_group: r.severity_group }, r.version, v) });
    if (res) { await recalc(ctx); ctx.toast('Saved.', 'success'); const h = el('div'); await renderPenalty(h, ctx); host.replaceChildren(...h.childNodes); }
  };
  host.replaceChildren(
    el('p', { class: 'muted small', style: 'margin-bottom:12px' }, 'Critical violations use the Major column. The highest offense number is the ban level.'),
    el('div', { class: 'card card--flush' }, dataTable({ pageSize: 20, rows,
      columns: [{ key: 'offense_no', label: 'Offense', render: (r) => ordinal(r.offense_no) },
        { key: 'severity_group', label: 'Severity' }, { key: 'penalty', label: 'Penalty' },
        { key: 'hold_days', label: 'Hold (days)' },
        { key: 'a', label: '', nosort: true, render: (r) => el('button', { class: 'btn btn--sm', type: 'button', onclick: () => edit(r) }, 'Edit') }] })));
}

// ---------- monitoring period ----------
async function renderMonitoring(host, ctx) {
  const { data, error } = await ctx.sb.from('settings').select('*').eq('key', 'monitoring_days').maybeSingle();
  if (error) throw error;
  if (!data) { host.replaceChildren(el('div', { class: 'alert alert--error' }, 'Setting "monitoring_days" is missing. Run supabase/migrations/008_seed_fix_monitoring_training.sql.')); return; }
  const edit = async () => {
    const res = await formModal({ title: 'Monitoring period',
      fields: [{ name: 'days', label: 'Days', type: 'number', required: true, min: 1, max: 365, step: 1,
        hint: 'A new counted violation within this many days of the previous offense raises the offense level.' }],
      values: { days: Number(data.value) },
      onSubmit: (v) => updateVersionedBy(ctx.sb, 'settings', { key: 'monitoring_days' }, data.version, { value: v.days }) });
    if (res) { await recalc(ctx); ctx.toast('Saved.', 'success'); const h = el('div'); await renderMonitoring(h, ctx); host.replaceChildren(...h.childNodes); }
  };
  host.replaceChildren(el('div', { class: 'card stack', style: 'max-width:520px' },
    el('div', { class: 'card__title' }, 'Offense monitoring period'),
    el('div', { class: 'stat' }, `${Number(data.value)} days`),
    el('p', { class: 'muted small' }, 'Used by the offense engine for every technician. Changing it recalculates pending proposals; decided approvals are never altered.'),
    el('div', {}, el('button', { class: 'btn btn--primary', type: 'button', onclick: edit }, 'Change'))));
}

// ---------- users ----------
const ROLES = [['admin', 'Admin'], ['qa', 'QA'], ['trainer', 'Trainer'], ['supervisor', 'Supervisor'], ['viewer', 'Viewer']];
async function renderUsers(host, ctx) {
  const { data: rows, error } = await ctx.sb.from('profiles').select('*').order('full_name');
  if (error) throw error;
  const roleLabel = Object.fromEntries(ROLES);
  const edit = async (r) => {
    const self = r.user_id === ctx.profile.user_id;
    const res = await formModal({ title: 'Edit user',
      intro: self ? el('div', { class: 'alert alert--info' }, 'You cannot change your own role or active status.') : null,
      fields: [{ name: 'full_name', label: 'Full name', type: 'text', required: true, maxlength: 120 },
        { name: 'role', label: 'Role', type: 'select', required: true, options: ROLES.map(([value, label]) => ({ value, label })), disabled: self },
        { name: 'active', label: 'Active (can sign in and see data)', type: 'checkbox', disabled: self }],
      values: r,
      onSubmit: (v) => {
        const patch = { full_name: v.full_name };
        if (!self) { patch.role = v.role; patch.active = v.active; }
        return updateVersionedBy(ctx.sb, 'profiles', { user_id: r.user_id }, r.version, patch);
      } });
    if (res) { ctx.toast('Saved.', 'success'); const h = el('div'); await renderUsers(h, ctx); host.replaceChildren(...h.childNodes); }
  };
  host.replaceChildren(
    el('div', { class: 'alert alert--info' }, 'To add a user: Supabase Dashboard → Authentication → Users → Add user. New accounts appear here as inactive viewers until you assign a role and activate them.'),
    el('div', { class: 'card card--flush' }, dataTable({ rows, pageSize: 25, initialSort: { key: 'full_name' },
      columns: [{ key: 'full_name', label: 'Name' },
        { key: 'role', label: 'Role', render: (r) => badge(roleLabel[r.role] || r.role, 'green') },
        { key: 'active', label: 'Status', render: (r) => badge(r.active ? 'Active' : 'Inactive', r.active ? 'green' : 'amber') },
        { key: 'created_at', label: 'Created', render: (r) => fmtDateTime(r.created_at) },
        { key: 'a', label: '', nosort: true, render: (r) => el('button', { class: 'btn btn--sm', type: 'button', onclick: () => edit(r) }, 'Edit') }] })));
}
