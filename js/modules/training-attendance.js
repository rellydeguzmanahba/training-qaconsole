import { el } from '../utils/dom.js';
import { friendlyError } from '../utils/errors.js';
const dateLocal=(v)=>new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(v));
const iso=(v)=>new Date(v).toISOString();
let qrLoader;
function loadQr() {
 if(window.QRCode) return Promise.resolve();
 if(!qrLoader) qrLoader=new Promise((resolve,reject)=>{
   const s=document.createElement('script');
   s.src='https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
   s.onload=resolve;s.onerror=()=>reject(new Error('QR generator unavailable. Use Copy Link instead.'));
   document.head.append(s);
 });
 return qrLoader;
}
export async function renderAttendanceAdmin(root,ctx) {
 const body=el('div',{class:'stack'});root.append(body);
 async function draw(){
  const [sessions,types,techs]=await Promise.all([
   ctx.sb.rpc('attendance_admin_sessions'),
   ctx.sb.from('training_types').select('id,name').eq('active',true).order('name'),
   ctx.sb.from('technicians').select('id,first_name,surname').order('surname').limit(1000)
  ]);
  if(sessions.error){body.replaceChildren(el('p',{class:'muted'},'Attendance is not enabled. Apply migration 014 in Supabase SQL Editor.'));return;}
  const type=el('select',{class:'input','aria-label':'Training type'},(types.data||[]).map(t=>el('option',{value:t.id},t.name)));
  const title=el('input',{class:'input',placeholder:'Session title','aria-label':'Session title'});
  const venue=el('input',{class:'input',placeholder:'Venue / location','aria-label':'Venue'});
  const start=el('input',{class:'input',type:'datetime-local','aria-label':'Start time'});
  const end=el('input',{class:'input',type:'datetime-local','aria-label':'End time'});
  const create=el('button',{class:'btn btn--primary',type:'button',onclick:async()=>{
   if(!title.value.trim()||!start.value||!end.value) return ctx.toast('Complete title, start and end.','error');
   const {error}=await ctx.sb.rpc('attendance_create_session',{p_training_type_id:type.value,p_title:title.value.trim(),p_starts_at:iso(start.value),p_ends_at:iso(end.value),p_venue:venue.value,p_grace_minutes:15});
   if(error)return ctx.toast(friendlyError(error),'error');
   ctx.toast('Session created. Assign employees below.','success');await draw();
  }},'Create session');
  body.replaceChildren(el('h3',{},'Training attendance sessions'),
   el('section',{class:'card portal-card'},el('h3',{},'New training session'),el('div',{class:'stack'},type,title,venue,
    el('label',{},'Start (local time)',start),el('label',{},'End (local time)',end),create)));
  for(const s of sessions.data||[]){
   const employee=el('select',{class:'input','aria-label':'Assign employee'},(techs.data||[]).map(t=>el('option',{value:t.id},t.first_name+' '+t.surname)));
   const assign=el('button',{class:'btn btn--sm',type:'button',onclick:async()=>{
    const {error}=await ctx.sb.rpc('attendance_assign',{p_session_id:s.id,p_technician_id:employee.value});
    if(error)return ctx.toast(friendlyError(error),'error');
    ctx.toast('Employee assigned.','success');await draw();
   }},'Assign');
   const link=new URL(window.location.href);link.hash='/dashboard?attendance='+s.qr_token;
   const qrHost=el('div',{class:'attendance-qr'});
   const qrButton=el('button',{class:'btn btn--sm',type:'button',onclick:async()=>{
    try{await loadQr();qrHost.replaceChildren();new window.QRCode(qrHost,{text:link.href,width:180,height:180});}
    catch(e){ctx.toast(e.message,'error');}
   }},'Show QR');
   const copy=el('button',{class:'btn btn--sm',type:'button',onclick:async()=>{
    try{await navigator.clipboard.writeText(link.href);ctx.toast('Attendance link copied.','success');}
    catch{ctx.toast('Could not copy link.','error');}
   }},'Copy Link');
   const reviewHost=el('div',{class:'stack'});
   const reviews=el('button',{class:'btn btn--sm',type:'button',onclick:async()=>{
     const {data,error}=await ctx.sb.rpc('attendance_review_queue',{p_session_id:s.id});
     if(error)return ctx.toast(friendlyError(error),'error');
     reviewHost.replaceChildren();
     for(const row of data||[]){
       const line=el('div',{class:'attendance-session'},
         el('strong',{},row.employee_name),
         el('span',{class:'small muted'},'Time In: '+(row.time_in?dateLocal(row.time_in):'Not checked in')+
           ' · Time Out: '+(row.time_out?dateLocal(row.time_out):'—')+
           ' · Verification: '+row.verification_status));
       if(row.evidence_path){
         const {data:link,error:le}=await ctx.sb.storage.from('training-attendance').createSignedUrl(row.evidence_path,120);
         if(!le&&link?.signedUrl)line.append(el('a',{href:link.signedUrl,target:'_blank',rel:'noopener noreferrer'},'View attendance photo (2-minute link)'));
       }
       if(row.verification_status==='pending'){
         for(const [label,approved] of [['Approve',true],['Reject',false]]){
           line.append(el('button',{class:'btn btn--sm',type:'button',onclick:async()=>{
             const note=approved?null:prompt('Reason for rejection (optional):');
             const {error:e}=await ctx.sb.rpc('attendance_review',{p_session_id:s.id,p_technician_id:row.technician_id,p_approved:approved,p_note:note});
             if(e)return ctx.toast(friendlyError(e),'error');
             ctx.toast('Attendance reviewed.','success');reviews.click();
           }},label));
         }
       }
       reviewHost.append(line);
     }
     if(!data?.length)reviewHost.append(el('p',{class:'muted'},'No employees assigned.'));
   }},'View Attendance & Photos');
   body.append(el('section',{class:'card portal-card'},el('h3',{},s.title),
    el('p',{class:'small muted'},dateLocal(s.starts_at)+' – '+dateLocal(s.ends_at)+' · '+(s.venue||'No venue')),
    el('p',{class:'small'},s.checked_in+' checked in / '+s.participants+' assigned'),
    el('div',{class:'row'},employee,assign,qrButton,copy,reviews),qrHost,reviewHost));
  }
 }
 await draw();
}
