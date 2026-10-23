import { el } from '../utils/dom.js';
import { dataTable } from '../ui/table.js';
import { formModal } from '../ui/form.js';
import { badge, MONITORING_VARIANT, deploymentVariant } from '../ui/badge.js';
import { fetchAll, updateVersioned } from '../utils/db.js';
import { friendlyError } from '../utils/errors.js';
import { fmtDate, fmtDateTime } from '../utils/dates.js';
import { ordinal } from '../utils/validate.js';

const nm = (t) => (t ? `${t.first_name} ${t.surname}` : '—');
const APPROVAL_VARIANT = { proposed: 'amber', approved: 'green', rejected: 'red' };
const APPROVAL_LABEL = { proposed: 'Awaiting approval', approved: 'Approved', rejected: 'Rejected' };

const VIEWS = {
  active:   ['Active cases', (r) => ['UNDER MONITORING', 'BANNED'].includes(r.monitoring_status) || r.hold_until || r.pending_approvals > 0],
  review:   ['Needs review', (r) => r.requires_review],
  blocked:  ['On hold or banned', (r) => r.monitoring_status === 'BANNED' || r.hold_until],
  cleared:  ['Cleared', (r) => r.monitoring_status === 'CLEARED'],
  none:     ['No offense', (r) => r.monitoring_status === 'No offense'],
  all:      ['All technicians', () => true],
};

export async function render(root, ctx) {
  const { sb } = ctx;
  const S = { tab: 'monitoring', view: 'active', company: '', astatus: 'proposed' };
  let D;
  const body = el('div');

  async function load() {
    const [st, ac, rules, co, prof] = await Promise.all([
      fetchAll(() => sb.from('v_offense_status').select('*').order('full_name').order('technician_id')),
      fetchAll(() => sb.from('offense_actions')
        .select('id,technician_id,violation_id,offense_date,offense_no,penalty,hold_days,hold_until,status,decided_by,decided_at,decision_note,lifted_at,lift_reason,version,technician:technicians(first_name,surname)')
        .order('offense_date', { ascending: false }).order('id')),
      sb.from('penalty_rules').select('offense_no'),
      sb.from('companies').select('name').eq('active', true).order('name'),
      sb.from('profiles').select('user_id,full_name'),
    ]);
    for (const r of [rules, co, prof]) if (r.error) throw r.error;
    D = { st, ac, ban: Math.max(0, ...rules.data.map((r) => r.offense_no)), companies: co.data,
      people: new Map(prof.data.map((p) => [p.user_id, p.full_name])) };
  }
  const refresh = async () => { await load(); draw(); };
  const run = async (fn, ok) => { try { await fn(); ctx.toast(ok, 'success'); await refresh(); } catch (e) { ctx.toast(friendlyError(e), 'error'); } };

  // ---------- actions ----------
  const decide = async (row, status) => {
    const approve = status === 'approved';
    const r = await formModal({
      title: approve ? 'Approve restriction' : 'Reject restriction', submitText: approve ? 'Approve' : 'Reject',
      intro: el('p', { class: 'muted' }, `${nm(row.technician)} — ${ordinal(row.offense_no)} offense: ${row.penalty}${row.hold_until ? ` (hold until ${fmtDate(row.hold_until)})` : ''}. ${approve ? 'The restriction takes effect immediately.' : 'No restriction will be applied.'}`),
      fields: [{ name: 'note', label: 'Decision note', type: 'textarea', required: !approve, maxlength: 500 }],
      onSubmit: (v) => updateVersioned(sb, 'offense_actions', row.id, row.version, { status, decision_note: v.note }),
    });
    if (r) { ctx.toast(approve ? 'Approved.' : 'Rejected.', 'success'); await refresh(); }
  };
  const lift = async (row) => {
    const r = await formModal({
      title: 'Lift ban', submitText: 'Lift ban',
      intro: el('p', { class: 'muted' }, `${nm(row.technician)} will become deployable and the offense count restarts. Violations dated on or before today no longer count. This is recorded in the audit log.`),
      fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true, maxlength: 500 }],
      onSubmit: async (v) => { const { error } = await sb.rpc('lift_ban', { p_action: row.id, p_reason: v.reason }); if (error) throw error; },
    });
    if (r) { ctx.toast('Ban lifted.', 'success'); await refresh(); }
  };
  const recalc = () => run(async () => { const { error } = await sb.rpc('recalculate_offenses', { p_technician: null }); if (error) throw error; }, 'Offenses recalculated.');

  // ---------- tabs ----------
  function monitoring() {
    const sel = el('select', { class: 'input', 'aria-label': 'View' }, Object.entries(VIEWS).map(([k, [t]]) => el('option', { value: k }, t)));
    sel.value = S.view;
    const co = el('select', { class: 'input', 'aria-label': 'Company' }, el('option', { value: '' }, 'All companies'),
      D.companies.map((c) => el('option', { value: c.name }, c.name)));
    co.value = S.company;
    const holder = el('div', { class: 'card card--flush' });
    const paint = () => {
      S.view = sel.value; S.company = co.value;
      const rows = D.st.filter((r) => VIEWS[S.view][1](r) && (!S.company || r.company === S.company));
      holder.replaceChildren(dataTable({ rows, pageSize: 25, initialSort: { key: 'current_offense_no', dir: 'desc' }, empty: 'No technicians in this view.',
        columns: [
          { key: 'full_name', label: 'Technician', render: (r) => el('a', { href: `#/technicians/${r.technician_id}` }, r.full_name) },
          { key: 'company', label: 'Company' },
          { key: 'monitoring_status', label: 'Monitoring', render: (r) => badge(r.monitoring_status, MONITORING_VARIANT[r.monitoring_status]) },
          { key: 'current_offense_no', label: 'Offense', render: (r) => (r.current_offense_no ? ordinal(r.current_offense_no) : '—') },
          { key: 'monitoring_until', label: 'Until', render: (r) => (r.current_offense_no ? fmtDate(r.monitoring_until) : '—') },
          { key: 'current_penalty', label: 'Current penalty' },
          { key: 'deployment_status', label: 'Deployment', render: (r) => badge(r.deployment_status, deploymentVariant(r.deployment_status)) },
          { key: 'review_reason', label: 'Review', render: (r) => (r.requires_review ? badge(r.review_reason || 'Review', 'amber') : '—') },
          { key: 'next', label: 'If violated again', sort: (r) => r.next_offense_no ?? 99, render: (r) => (r.next_offense_no
            ? el('div', { class: 'small' }, `${ordinal(r.next_offense_no)}: `, r.next_if_minor === r.next_if_major ? r.next_if_minor : `${r.next_if_minor} (minor) / ${r.next_if_major} (major)`) : '—') }] }));
    };
    [sel, co].forEach((n) => n.addEventListener('input', paint));
    paint();
    return el('div', { class: 'stack' }, el('div', { class: 'toolbar' }, sel, co), holder);
  }

  function approvals() {
    const sel = el('select', { class: 'input', 'aria-label': 'Approval status' },
      [['proposed', 'Awaiting approval'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['', 'All']].map(([v, t]) => el('option', { value: v }, t)));
    sel.value = S.astatus;
    const holder = el('div', { class: 'card card--flush' });
    const paint = () => {
      S.astatus = sel.value;
      const rows = D.ac.filter((r) => !S.astatus || r.status === S.astatus);
      holder.replaceChildren(dataTable({ rows, pageSize: 25, initialSort: { key: 'offense_date', dir: 'desc' }, empty: 'Nothing here.',
        columns: [
          { key: 'offense_date', label: 'Offense date', render: (r) => el('a', { href: `#/violations/${r.violation_id}` }, fmtDate(r.offense_date)) },
          { key: 'tech', label: 'Technician', sort: (r) => nm(r.technician), render: (r) => el('a', { href: `#/technicians/${r.technician_id}` }, nm(r.technician)) },
          { key: 'offense_no', label: 'Offense', render: (r) => ordinal(r.offense_no) },
          { key: 'penalty', label: 'Proposed restriction' },
          { key: 'hold_until', label: 'Hold until', render: (r) => (r.hold_until ? fmtDate(r.hold_until) : '—') },
          { key: 'status', label: 'Status', render: (r) => el('div', {}, badge(APPROVAL_LABEL[r.status], APPROVAL_VARIANT[r.status]),
            r.lifted_at ? el('div', { class: 'small muted' }, `Lifted ${fmtDate(r.lifted_at.slice(0, 10))}`) : null) },
          { key: 'decided', label: 'Decision', sort: (r) => r.decided_at ?? '', render: (r) => (r.decided_at
            ? el('div', { class: 'small' }, D.people.get(r.decided_by) ?? 'Unknown', el('br'), fmtDateTime(r.decided_at), r.decision_note ? el('div', { class: 'muted' }, r.decision_note) : null) : '—') },
          { key: 'a', label: '', nosort: true, render: (r) => {
            if (!ctx.can('offenses:decide')) return null;
            if (r.status === 'proposed') return el('div', { class: 'cell-actions' },
              el('button', { class: 'btn btn--sm btn--primary', type: 'button', onclick: () => decide(r, 'approved') }, 'Approve'),
              el('button', { class: 'btn btn--sm', type: 'button', onclick: () => decide(r, 'rejected') }, 'Reject'));
            if (r.status === 'approved' && r.offense_no >= D.ban && !r.lifted_at) return el('button', { class: 'btn btn--sm', type: 'button', onclick: () => lift(r) }, 'Lift ban');
            return null;
          } }] }));
    };
    sel.addEventListener('input', paint);
    paint();
    return el('div', { class: 'stack' }, el('div', { class: 'toolbar' }, sel), holder);
  }

  function draw() {
    const n = (f) => D.st.filter(f).length;
    stats.replaceChildren(...[
      ['Under monitoring', n((r) => r.monitoring_status === 'UNDER MONITORING')], ['Banned', n((r) => r.monitoring_status === 'BANNED')],
      ['On hold', n((r) => r.hold_until)], ['Awaiting approval', D.ac.filter((a) => a.status === 'proposed').length],
      ['Needs review', n((r) => r.requires_review)],
    ].map(([t, v]) => el('div', { class: 'card' }, el('div', { class: 'card__title' }, t), el('div', { class: 'stat' }, v))));
    tabs.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === S.tab)));
    body.replaceChildren(S.tab === 'monitoring' ? monitoring() : approvals());
  }

  const stats = el('div', { class: 'grid grid--cards', style: 'margin-bottom:16px' });
  const tabs = el('div', { class: 'tabs', role: 'tablist' }, [['monitoring', 'Monitoring'], ['approvals', 'Approvals']].map(([id, label]) =>
    el('button', { class: 'tab', type: 'button', role: 'tab', dataset: { id }, onclick: () => { S.tab = id; draw(); } }, label)));

  try { await load(); } catch (e) {
    console.error(e);
    root.append(el('div', { class: 'alert alert--error' }, friendlyError(e)));
    return;
  }
  root.append(
    el('div', { class: 'page-head' }, el('div', {}, el('h2', {}, 'Offense Monitoring'),
      el('p', { class: 'muted small' }, 'Holds and bans take effect only after a supervisor or admin approves them.')),
      ctx.can('offenses:recalc') ? el('button', { class: 'btn', type: 'button', onclick: recalc }, 'Recalculate') : null),
    stats, tabs, body);
  draw();
}
