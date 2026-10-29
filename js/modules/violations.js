import { el } from '../utils/dom.js';
import { dataTable } from '../ui/table.js';
import { badge, SEVERITY_VARIANT, VIOLATION_STATUS_VARIANT } from '../ui/badge.js';
import { fetchAll } from '../utils/db.js';
import { friendlyError } from '../utils/errors.js';
import { fmtDate } from '../utils/dates.js';
import { openViolationForm, SEVERITIES, VSTATUSES } from './violation-form.js';

export async function render(root, ctx) {
  if (ctx.params[0]) {                                   // #/violations/<id>
    const { renderDetail } = await import('./violation-detail.js');
    return renderDetail(root, ctx, ctx.params[0]);
  }
  const { sb } = ctx;
  let rows, cats, companies, policy=[];
  try {
    const [v, c, co] = await Promise.all([
      fetchAll(() => sb.from('violations')
        .select('id,technician_id,violation_date,severity,status,retraining_required,description,reported_by,ibas_no,jo_number,technician:technicians(first_name,surname,company_id),violation_category_links(category_id,violation_categories(code)),violation_evidence(id)')
        .order('violation_date', { ascending: false }).order('id')),
      sb.from('violation_categories').select('id,code,name').order('code'),
      sb.from('companies').select('id,name').eq('active', true).order('name'),
    ]);
    for (const r of [c, co]) if (r.error) throw r.error;
    cats = c.data; companies = co.data;
    const policyResult=await sb.from('qa_penalty_reference').select('violation_code,violation_type,penalty_text').limit(1000);
    if(!policyResult.error)policy=policyResult.data||[];
    rows = v.map((x) => ({
      ...x, tech: x.technician ? `${x.technician.first_name} ${x.technician.surname}` : '—',
      company_id: x.technician?.company_id, cat_ids: x.violation_category_links.map((l) => l.category_id),
      codes: x.violation_category_links.map((l) => l.violation_categories?.code).filter(Boolean).join(', '),
      evidence: x.violation_evidence.length,
    }));
  } catch (e) {
    console.error(e);
    root.append(el('div', { class: 'alert alert--error' }, friendlyError(e)));
    return;
  }

  const normalizeCode=(v)=>String(v||'').toUpperCase().replace(/\\s+/g,'');
  const byTech=new Map();
  for(const row of rows){if(!byTech.has(row.technician_id))byTech.set(row.technician_id,[]);byTech.get(row.technician_id).push(row);}
  const policyMap=new Map();
  for(const item of policy){const key=normalizeCode(item.violation_code);if(!policyMap.has(key))policyMap.set(key,[]);policyMap.get(key).push(item);}
  const techPreview=(r)=>{
    const wrap=el('span',{class:'qa-tech-preview'});
    const link=el('a',{href:`#/technicians/${r.technician_id}`},r.tech);
    const trigger=el('button',{class:'qa-tech-preview__trigger',type:'button','aria-label':'Show violations and penalty reference for '+r.tech,'aria-expanded':'false'},'ⓘ');
    const popup=el('div',{class:'qa-tech-preview__popup',role:'region','aria-label':'Violation history for '+r.tech});
    const history=byTech.get(r.technician_id)||[];
    popup.append(el('strong',{},r.tech+' · '+history.length+' recorded violation'+(history.length===1?'':'s')),
      el('p',{class:'small muted'},'Reference penalties from PPM-OPG-PRP-008 V1.0. Not an assessed fine or automatic disciplinary decision.'));
    for(const item of history.slice(0,12)){
      const section=el('div',{class:'qa-tech-preview__item'},
        el('a',{href:`#/violations/${item.id}`},fmtDate(item.violation_date)+' · '+(item.codes||'Uncoded')),
        el('span',{class:'small muted'},item.status+' · '+item.severity));
      const codes=item.codes.split(',').map(x=>x.trim()).filter(Boolean);
      for(const code of codes){
        const matches=policyMap.get(normalizeCode(code))||[];
        if(!matches.length){section.append(el('div',{class:'small muted'},code+': No matching code in uploaded penalty reference.'));continue;}
        for(const m of matches)section.append(el('div',{class:'qa-tech-preview__penalty'},
          el('strong',{},m.violation_type+' ('+code+')'),
          el('div',{class:'small'},m.penalty_text)));
      }
      popup.append(section);
    }
    if(history.length>12)popup.append(el('p',{class:'small muted'},'Showing 12 of '+history.length+' records. Open technician profile for full history.'));
    const close=()=>{wrap.classList.remove('is-open');trigger.setAttribute('aria-expanded','false');};
    trigger.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();const opening=!wrap.classList.contains('is-open');document.querySelectorAll('.qa-tech-preview.is-open').forEach(n=>n.classList.remove('is-open'));wrap.classList.toggle('is-open',opening);trigger.setAttribute('aria-expanded',String(opening));});
    wrap.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
    wrap.append(link,trigger,popup);
    return wrap;
  };
  const sel = (label, opts) => el('select', { class: 'input', 'aria-label': label },
    el('option', { value: '' }, `All ${label.toLowerCase()}`), opts.map(([v, t]) => el('option', { value: String(v) }, t)));
  const q = el('input', { class: 'input', type: 'search', placeholder: 'Search technician, description, IBAS/JO…', 'aria-label': 'Search' });
  const fStatus = sel('Statuses', VSTATUSES.map((s) => [s, s]));
  const fSev = sel('Severities', SEVERITIES.map((s) => [s, s]));
  const fCat = sel('Categories', cats.map((c) => [c.id, `${c.code} – ${c.name}`.slice(0, 70)]));
  const fCo = sel('Companies', companies.map((c) => [c.id, c.name]));
  const fCount = sel('Offense impact', [['yes', 'Counts as offense'], ['no', 'Does not count']]);
  const from = el('input', { class: 'input', type: 'date', 'aria-label': 'From date' });
  const to = el('input', { class: 'input', type: 'date', 'aria-label': 'To date' });
  const count = el('span', { class: 'muted small' });

  const table = dataTable({ pageSize: 25, rows, initialSort: { key: 'violation_date', dir: 'desc' }, empty: 'No violations match your filters.',
    columns: [
      { key: 'violation_date', label: 'Date', render: (r) => el('a', { href: `#/violations/${r.id}` }, fmtDate(r.violation_date)) },
      { key: 'tech', label: 'Technician', render: techPreview },
      { key: 'codes', label: 'Categories' },
      { key: 'severity', label: 'Severity', render: (r) => badge(r.severity, SEVERITY_VARIANT[r.severity]) },
      { key: 'status', label: 'Status', render: (r) => badge(r.status, VIOLATION_STATUS_VARIANT[r.status]) },
      { key: 'retraining_required', label: 'Counts', render: (r) => (r.retraining_required ? 'Yes' : 'No') },
      { key: 'evidence', label: 'Evidence', render: (r) => (r.evidence ? badge(String(r.evidence), 'green') : badge('None', 'amber')) },
      { key: 'reported_by', label: 'Reported by' }] });

  const apply = () => {
    const t = q.value.trim().toLowerCase();
    const list = rows.filter((r) =>
      (!t || [r.tech, r.description, r.ibas_no, r.jo_number, r.reported_by].some((x) => String(x ?? '').toLowerCase().includes(t))) &&
      (!fStatus.value || r.status === fStatus.value) && (!fSev.value || r.severity === fSev.value) &&
      (!fCat.value || r.cat_ids.includes(Number(fCat.value))) && (!fCo.value || String(r.company_id) === fCo.value) &&
      (!fCount.value || (fCount.value === 'yes') === r.retraining_required) &&
      (!from.value || r.violation_date >= from.value) && (!to.value || r.violation_date <= to.value));
    table.setRows(list);
    count.textContent = `${list.length} of ${rows.length}`;
  };
  [q, fStatus, fSev, fCat, fCo, fCount, from, to].forEach((n) => n.addEventListener('input', apply));

  const add = async () => {
    try {
      const id = await openViolationForm(ctx);
      if (id) { ctx.toast('Violation recorded.', 'success'); ctx.navigate(`violations/${id}`); }
    } catch (e) { ctx.toast(friendlyError(e), 'error'); }
  };

  root.append(
    el('div', { class: 'page-head' }, el('div', {}, el('h2', {}, 'QA Violations'), count),
      ctx.can('violations:write') ? el('button', { class: 'btn btn--primary', type: 'button', onclick: add }, 'Record violation') : null),
    el('div', { class: 'toolbar' }, q, fStatus, fSev, fCat, fCo, fCount,
      el('label', { class: 'row small' }, 'From', from), el('label', { class: 'row small' }, 'To', to)),
    el('div', { class: 'card card--flush' }, table));
  apply();
}
