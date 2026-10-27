import { el } from '../utils/dom.js';
import { dataTable } from '../ui/table.js';
import { formModal } from '../ui/form.js';
import { showModal } from '../ui/dialog.js';
import { badge } from '../ui/badge.js';
import { fmtDateTime } from '../utils/dates.js';
import { friendlyError } from '../utils/errors.js';
import { errorState } from '../ui/states.js';

// Admin-only. Accounts are created in Supabase Auth; linking is an explicit admin decision on a verified account.
export async function renderAccounts(host, ctx) {
  const { sb } = ctx;
  const reload = async () => { const h = el('div'); await renderAccounts(h, ctx); host.replaceChildren(...h.childNodes); };
  const [acc, techs] = await Promise.all([
    sb.rpc('admin_list_accounts'),
    sb.from('technicians').select('id,first_name,surname,email,employment_status').order('surname').order('first_name'),
  ]);
  if (acc.error) {
    if (acc.error.code === 'PGRST202' || /admin_list_accounts/.test(acc.error.message || '')) {
      host.replaceChildren(el('div', { class: 'callout' }, 'Technician accounts are not enabled yet. An admin must review and run migrations 010a and 010b first.'));
      return;
    }
    host.replaceChildren(errorState(friendlyError(acc.error), reload)); return;
  }
  if (techs.error) { host.replaceChildren(errorState(friendlyError(techs.error), reload)); return; }

  const linked = new Set(acc.data.map((a) => a.technician_id).filter(Boolean));
  const free = techs.data.filter((t) => !linked.has(t.id) && !['Resigned', 'Terminated'].includes(t.employment_status));

  const link = async (a) => {
    const r = await formModal({
      title: 'Link technician account', submitText: 'Link account',
      intro: el('p', { class: 'muted small' }, `Account ${a.email}. After linking, this person signs in to the technician portal and sees only their own records. The link is audit-logged.`),
      fields: [{ name: 'technician_id', label: 'Employee', type: 'select', required: true,
        options: free.map((t) => ({ value: t.id, label: `${t.surname}, ${t.first_name}${t.email ? ` (${t.email})` : ''}` })) }],
      onSubmit: async (v) => {
        const t = free.find((x) => x.id === v.technician_id);
        if (t?.email && t.email.toLowerCase() !== String(a.email).toLowerCase()) {
          const ans = await showModal({ title: 'Email differs', body: el('p', { class: 'muted' }, `The account email (${a.email}) is different from the email on the employee record (${t.email}). Link anyway?`),
            actions: [{ label: 'Go back', value: 'no' }, { label: 'Link anyway', value: 'yes', class: 'btn--primary' }], focusIndex: 0 });
          if (ans !== 'yes') throw Object.assign(new Error(''), { code: 'P0001' });
        }
        const { error } = await sb.rpc('link_technician_account', { p_user_id: a.user_id, p_technician_id: v.technician_id });
        if (error) throw error;
      },
    });
    if (r) { ctx.toast('Account linked.', 'success'); await reload(); }
  };
  const unlink = async (a) => {
    if (!(await ctx.confirm({ title: 'Unlink this account?', danger: true, confirmText: 'Unlink',
      message: `${a.email} will lose access to ${a.technician_name}'s portal and be deactivated. The employee record is not changed.` }))) return;
    const { error } = await sb.rpc('unlink_technician_account', { p_user_id: a.user_id });
    if (error) return ctx.toast(friendlyError(error), 'error');
    ctx.toast('Account unlinked and deactivated.', 'success'); await reload();
  };

  host.replaceChildren(
    el('div', { class: 'alert alert--info' }, 'To add a technician login: Supabase Dashboard → Authentication → Users → Add user (email verified), then link it here. Accounts are never matched to employees automatically.'),
    el('div', { class: 'card card--flush' }, dataTable({ rows: acc.data, pageSize: 25, initialSort: { key: 'email' }, label: 'Accounts',
      columns: [{ key: 'email', label: 'Account email' },
        { key: 'email_confirmed', label: 'Verified', render: (a) => badge(a.email_confirmed ? 'Verified' : 'Not verified', a.email_confirmed ? 'green' : 'amber') },
        { key: 'role', label: 'Role', render: (a) => (a.role ? badge(a.role, a.role === 'technician' ? 'green' : '') : '—') },
        { key: 'active', label: 'Status', render: (a) => (a.role ? badge(a.active ? 'Active' : 'Inactive', a.active ? 'green' : 'amber') : '—') },
        { key: 'technician_name', label: 'Linked employee' },
        { key: 'last_sign_in_at', label: 'Last sign-in', render: (a) => fmtDateTime(a.last_sign_in_at) },
        { key: 'a', label: '', nosort: true, render: (a) => {
          if (a.technician_id) return el('button', { class: 'btn btn--sm', type: 'button', onclick: () => unlink(a) }, 'Unlink');
          if (!['viewer', 'technician'].includes(a.role) || !a.email_confirmed) return null;
          return el('button', { class: 'btn btn--sm btn--primary', type: 'button', onclick: () => link(a) }, 'Link employee');
        } }] })));
}
