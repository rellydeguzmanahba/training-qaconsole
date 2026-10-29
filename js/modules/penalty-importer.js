import { el } from '../utils/dom.js';
import { loadXLSX } from '../import/sheetjs.js';
import { friendlyError } from '../utils/errors.js';

const trim = x => String(x ?? '').trim();
const key = x => trim(x).toLowerCase().replace(/[^a-z0-9]/g,'');
const specs=[
 ['violation_code','Violation code',['code','violationcode','violationid']],
 ['violation_type','Violation type',['type','violationtype','natureofviolation','violation']],
 ['description','Description',['description','details','violationdescription']],
 ['penalty_text','Penalty',['penalty','penalties','penaltystructure','correspondingpenalty']]
];
export function createPenaltyImporter(ctx,refresh){
 const root=el('section',{class:'card qa-import-card'});
 const file=el('input',{class:'input',type:'file',accept:'.xlsx,.xls','aria-label':'Penalty workbook'});
 const status=el('p',{class:'small muted',role:'status'},'Select an Excel workbook to preview.');
 const area=el('div',{class:'stack'});
 root.append(el('h3',{},'Import / Update Penalty Structure'),
   el('p',{class:'muted small'},'Admin only. Upload the 8.4 penalty workbook or a revised version. Preview and validate before saving. Existing violation and attendance history is never changed.'),
   file,status,area);
 let wb,grid=[],sheet='',header=0,mapping={};
 const message=(s)=>{status.textContent=s;};
 function selector(label,options,value,change){
   const select=el('select',{class:'input','aria-label':label});
   for(const [v,t] of options)select.append(el('option',{value:String(v)},t));
   select.value=String(value);
   select.addEventListener('change',()=>change(select.value));
   return el('label',{class:'qa-import-field'},el('span',{},label),select);
 }
 function show(){
   area.replaceChildren();
   if(!wb)return;
   grid=window.XLSX.utils.sheet_to_json(wb.Sheets[sheet],{header:1,defval:'',raw:false,blankrows:false});
   if(!grid.length){message('This worksheet is empty.');return;}
   header=Math.min(header,grid.length-1);
   const hdr=grid[header]||[];
   const width=Math.min(100,Math.max(0,...grid.slice(0,200).map(x=>x.length)));
   const columns=Array.from({length:width},(_,i)=>[i,'Column '+(i+1)+' · '+trim(hdr[i]).slice(0,65)]);
   const headerOptions=grid.slice(0,Math.min(grid.length,35)).map((r,i)=>[i,'Row '+(i+1)+' · '+r.slice(0,5).map(trim).join(' / ').slice(0,90)]);
   mapping={};
   for(const [field,,aliases] of specs){
     mapping[field]=hdr.findIndex(v=>aliases.includes(key(v)));
   }
   const controls=el('div',{class:'qa-import-fields'});
   controls.append(selector('Worksheet',wb.SheetNames.map(x=>[x,x]),sheet,v=>{sheet=v;header=0;show();}),
     selector('Column header row',headerOptions,header,v=>{header=Number(v);show();}));
   for(const [field,label] of specs)controls.append(selector(label,[[-1,'— Not mapped —'],...columns],mapping[field],v=>{mapping[field]=Number(v);preview();}));
   area.append(controls);
   const view=el('div',{class:'stack'});
   area.append(view);
   function preview(){
     view.replaceChildren();
     const missing=['violation_code','violation_type','penalty_text'].filter(x=>mapping[x]<0);
     if(missing.length){view.append(el('div',{class:'alert alert--info'},'Map required columns: '+missing.join(', ')+'.'));return;}
     const records=[],issues=[],seen=new Set();
     for(let i=header+1;i<grid.length;i++){
       const row=grid[i],item={};
       for(const [field] of specs)item[field]=mapping[field]<0?'':trim(row[mapping[field]]);
       if(!Object.values(item).some(Boolean))continue;
       if(!item.violation_code||!item.violation_type||!item.penalty_text){issues.push('Row '+(i+1)+' missing code, type or penalty');continue;}
       const k=key(item.violation_code)+'|'+key(item.violation_type);
       if(seen.has(k)){issues.push('Row '+(i+1)+' duplicate code/type');continue;}
       seen.add(k);item.source_document=file.files[0]?.name||'Penalty workbook';
       records.push(item);
     }
     view.append(el('p',{class:'small'},records.length+' valid entries · '+issues.length+' issues'));
     if(issues.length)view.append(el('div',{class:'alert alert--error'},issues.slice(0,10).join('; ')));
     const table=el('div',{class:'qa-import-preview-table'});
     const t=el('table',{class:'table'});
     const headRow=el('tr'); for(const label of ['Code','Violation','Description','Penalty']) headRow.append(el('th',{},label)); t.append(el('thead',{},headRow));
     const body=el('tbody'); for(const record of records.slice(0,8)){const tr=el('tr');for(const value of [record.violation_code,record.violation_type,record.description,record.penalty_text])tr.append(el('td',{},value));body.append(tr);}t.append(body);
     table.append(t);view.append(table);
     const mode=selector('Import mode', [['merge','Add new / update matching codes'],['replace','Replace the entire reference catalog']], 'merge',()=>{});
     const btn=el('button',{class:'btn btn--primary',type:'button'},'Import '+records.length+' entries');
     view.append(mode,btn,el('p',{class:'small muted'},'Replace mode removes reference entries missing from the new workbook. It does not remove technician violations or disciplinary history.'));
     btn.disabled=!records.length||!!issues.length||records.length>1000;
     btn.addEventListener('click',async()=>{
       const replace=mode.querySelector('select').value==='replace';
       const confirmed=await ctx.confirm({title:replace?'Replace all penalty references?':'Import penalty references?',message:replace?'This replaces the entire policy reference catalog. Existing QA and offense history will remain unchanged.':'Matching code/type entries will be updated and new entries added.',confirmText:replace?'Replace references':'Import policies',danger:replace});
       if(!confirmed)return;
       btn.disabled=true;message('Importing '+records.length+' entries…');
       const {data,error}=await ctx.sb.rpc('qa_import_penalty_reference',{p_rows:records,p_replace:replace});
       if(error){message('Import failed: '+friendlyError(error)+' — run migration 019 if the function is missing.');btn.disabled=false;return;}
       message('Imported '+data+' entries successfully.');
       ctx.toast('Penalty structure updated.','success');
       await refresh();
     });
   }
   preview();
 }
 file.addEventListener('change',async()=>{
   const f=file.files?.[0];if(!f)return;
   if(f.size>15*1024*1024){message('File exceeds 15 MB.');return;}
   try{message('Reading workbook…');await loadXLSX();wb=window.XLSX.read(await f.arrayBuffer(),{type:'array'});sheet=wb.SheetNames[0];header=0;show();message('Choose the worksheet, header row and policy columns.');}
   catch(e){message('Could not read workbook: '+friendlyError(e));}
 });
 return root;
}
