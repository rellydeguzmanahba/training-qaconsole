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
    const popup=el('div',{class:'qa-tech-preview__popup',role:'region','aria-label':'Violation history for '+r.tech,tabindex:'-1'});
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
    const place=()=>{const box=trigger.getBoundingClientRect();const width=Math.min(440,window.innerWidth-24);popup.style.width=width+'px';popup.style.left=Math.max(12,Math.min(box.left,window.innerWidth-width-12))+'px';popup.style.top=(box.bottom+8+Math.min(380,window.innerHeight*.6)>window.innerHeight?Math.max(12,box.top-Math.min(380,window.innerHeight*.6)-8):box.bottom+8)+'px';};
    const close=()=>{wrap.classList.remove('is-open');trigger.setAttribute('aria-expanded','false');popup.remove();};
    const open=()=>{document.querySelectorAll('.qa-tech-preview.is-open').forEach(n=>n.dispatchEvent(new Event('qa-close')));place();document.body.append(popup);wrap.classList.add('is-open');trigger.setAttribute('aria-expanded','true');};
    wrap.addEventListener('qa-close',close);
    trigger.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();wrap.classList.contains('is-open')?close():open();});
    wrap.addEventListener('mouseenter',()=>{if(matchMedia('(hover:hover)').matches&&!wrap.classList.contains('is-open'))open();});
    wrap.addEventListener('mouseleave',(e)=>{if(!popup.contains(e.relatedTarget)&&matchMedia('(hover:hover)').matches)close();});
    popup.addEventListener('mouseleave',(e)=>{if(!wrap.contains(e.relatedTarget)&&matchMedia('(hover:hover)').matches)close();});
    popup.addEventListener('keydown',e=>{if(e.key==='Escape'){close();trigger.focus();}});
    document.addEventListener('click',e=>{if(!wrap.contains(e.target)&&!popup.contains(e.target)&&wrap.classList.contains('is-open'))close();},{signal:ctx.signal||undefined});
    const initials=r.tech.split(/\s+/).slice(0,2).map(n=>n[0]||'').join('').toUpperCase();
    wrap.append(el('span',{class:'qa-person-avatar','aria-hidden':'true'},initials),el('span',{class:'qa-person-name'},link,el('small',{},'Technician')),trigger);
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
  const count = el('span', { class: 'muted small qa-results-count' });
  const clear=el('button',{class:'btn btn--sm qa-clear-filters',type:'button',onclick:()=>{q.value='';for(const x of [fStatus,fSev,fCat,fCo,fCount,from,to])x.value='';apply();}},'Clear filters');
  const activeFilters=el('span',{class:'qa-active-filters small muted'},'All records');

  const quickAll=el('button',{class:'qa-quick is-selected',type:'button'},'All cases');
  const quickOpen=el('button',{class:'qa-quick',type:'button'},'Open cases');
  const quickClosed=el('button',{class:'qa-quick',type:'button'},'Closed cases');
  const quickMajor=el('button',{class:'qa-quick',type:'button'},'Major severity');
  const quickButtons=[quickAll,quickOpen,quickClosed,quickMajor];
  const quick=(button,status='',severity='')=>{fStatus.value=status;fSev.value=severity;quickButtons.forEach(b=>b.classList.toggle('is-selected',b===button));apply();};
  quickAll.onclick=()=>quick(quickAll);quickOpen.onclick=()=>quick(quickOpen,'Open');quickClosed.onclick=()=>quick(quickClosed,'Closed');quickMajor.onclick=()=>quick(quickMajor,'','Major');
  const table = dataTable({ pageSize: 25, rows, initialSort: { key: 'violation_date', dir: 'desc' }, empty: 'No violations match your filters.',
    columns: [
      { key: 'violation_date', label: 'Reported', render: (r) => el('div',{class:'qa-date-cell'},el('a', { href: `#/violations/${r.id}` }, fmtDate(r.violation_date)),el('small',{},'Case #'+String(r.id).slice(0,8))) },
      { key: 'tech', label: 'Technician', render: techPreview },
      { key: 'codes', label: 'Classification', render:(r)=>el('div',{class:'qa-classification'},el('span',{class:'qa-code'},r.codes||'Uncategorized'),el('small',{},r.retraining_required?'Counts toward offense':'Non-counting')) },
      { key: 'severity', label: 'Severity', render: (r) => badge(r.severity, SEVERITY_VARIANT[r.severity]) },
      { key: 'status', label: 'Status', render: (r) => badge(r.status, VIOLATION_STATUS_VARIANT[r.status]) },
      { key: 'evidence', label: 'Evidence', render: (r) => el('span',{class:'qa-evidence'},r.evidence?'▣  '+r.evidence+' file'+(r.evidence===1?'':'s'):'No files') },
      { key: 'action', label: 'Details', nosort:true, render:(r)=>el('a',{href:`#/violations/${r.id}`,class:'qa-view-case'},'View case →') }] });

  const apply = () => {
    const t = q.value.trim().toLowerCase();
    const list = rows.filter((r) =>
      (!t || [r.tech, r.description, r.ibas_no, r.jo_number, r.reported_by].some((x) => String(x ?? '').toLowerCase().includes(t))) &&
      (!fStatus.value || r.status === fStatus.value) && (!fSev.value || r.severity === fSev.value) &&
      (!fCat.value || r.cat_ids.includes(Number(fCat.value))) && (!fCo.value || String(r.company_id) === fCo.value) &&
      (!fCount.value || (fCount.value === 'yes') === r.retraining_required) &&
      (!from.value || r.violation_date >= from.value) && (!to.value || r.violation_date <= to.value));
    table.setRows(list);
    count.textContent = `${list.length} of ${rows.length} records`;
    const active=[fStatus,fSev,fCat,fCo,fCount,from,to].filter(x=>!!x.value).length+(t?1:0);
    activeFilters.textContent=active?active+' active filter'+(active===1?'':'s'):'All records';
    clear.hidden=!active;
    const selected=(!fStatus.value&&!fSev.value)?quickAll:(fStatus.value==='Open'&&!fSev.value)?quickOpen:(fStatus.value==='Closed'&&!fSev.value)?quickClosed:(!fStatus.value&&fSev.value==='Major')?quickMajor:null;
    quickButtons.forEach(b=>b.classList.toggle('is-selected',b===selected));
  };
  [q, fStatus, fSev, fCat, fCo, fCount, from, to].forEach((n) => n.addEventListener('input', apply));

  const add = async () => {
    try {
      const id = await openViolationForm(ctx);
      if (id) { ctx.toast('Violation recorded.', 'success'); ctx.navigate(`violations/${id}`); }
    } catch (e) { ctx.toast(friendlyError(e), 'error'); }
  };

  const summary=el('div',{class:'qa-summary qa-summary--premium'},
    el('div',{class:'qa-summary__card'},el('span',{},'Total records'),el('strong',{},String(rows.length))),
    el('div',{class:'qa-summary__card'},el('span',{},'Open cases'),el('strong',{},String(rows.filter(r=>String(r.status).toLowerCase()==='open').length))),
    el('div',{class:'qa-summary__card'},el('span',{},'Technicians'),el('strong',{},String(byTech.size))));
  const advanced=el('div',{class:'qa-advanced-filters',hidden:true},
    el('div', { class: 'toolbar qa-filters' }, fStatus, fSev, fCat, fCo, fCount,
      el('label', { class: 'row small' }, 'From', from), el('label', { class: 'row small' }, 'To', to)));
  const advancedToggle=el('button',{class:'qa-advanced-toggle',type:'button','aria-expanded':'false'},'More filters  +');
  advancedToggle.onclick=()=>{advanced.hidden=!advanced.hidden;advancedToggle.setAttribute('aria-expanded',String(!advanced.hidden));advancedToggle.textContent=advanced.hidden?'More filters  +':'Hide filters  −';};
  root.classList.add('qa-violations-workspace');
  root.append(
    el('section',{class:'qa-hero'},
      el('div',{class:'qa-hero__content'},
        el('span',{class:'qa-hero__eyebrow'},'AHBA DEVELOPMENT  /  QUALITY & COMPLIANCE'),
        el('h2',{},'Violation management'),
        el('p',{},'A clearer view of every case, from first report to resolution.'),
        el('div',{class:'qa-hero__foot'},el('span',{},'CASE REGISTER'),el('span',{},'·'),el('span',{},String(rows.length)+' total records'))),
      ctx.can('violations:write')?el('button',{class:'qa-hero__action',type:'button',onclick:add},'＋  Record violation'):null),
    summary,
    el('section',{class:'qa-command-bar'},
      el('div',{class:'qa-command-bar__top'},
        el('div',{class:'qa-command-bar__search'},el('span',{class:'qa-search-icon','aria-hidden':'true'},'⌕'),q),
        advancedToggle),
      el('div',{class:'qa-command-bar__bottom'},
        el('div',{class:'qa-quick-list'},...quickButtons),clear),
      advanced),
    el('div',{class:'qa-list-heading'},el('div',{},el('span',{class:'qa-section-kicker'},'CASE DIRECTORY'),el('h3',{},'Violation register'),el('span',{class:'muted small'},'Select a record to review details and supporting evidence')),el('div',{class:'qa-list-heading__meta'},activeFilters,count)),
    el('div', { class: 'card card--flush qa-violations-table' }, table));
  apply();
}
