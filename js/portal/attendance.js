import { el } from '../utils/dom.js';
import { friendlyError } from '../utils/errors.js';
import { resetPortalCache } from './data.js';
const format = (v) => v ? new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(v)) : '—';
export async function attendanceCard(ctx) {
 const card = el('section',{class:'card portal-card'},el('h3',{class:'portal-card__title'},'Training attendance'));
 const body = el('div',{class:'stack'});
 card.append(body);
 async function paint() {
   const {data,error}=await ctx.sb.from('v_my_training_sessions').select('*').order('starts_at',{ascending:false}).limit(20);
   if(error) { body.replaceChildren(el('p',{class:'muted'},'Training attendance is not enabled yet. Ask your administrator to apply migration 014.')); return; }
   const rows=data||[];
   const token = new URLSearchParams(location.hash.split('?')[1]||'').get('attendance');
   const input=el('input',{class:'input',placeholder:'Paste training QR code or link',value:token||'', 'aria-label':'Training attendance QR code'});
   const checkQr=el('button',{class:'btn btn--primary',type:'button',onclick:async()=>{
     const raw=input.value.trim(); const value=raw.match(/attendance=([0-9a-f-]{36})/i)?.[1]||raw;
     if(!/^[0-9a-f-]{36}$/i.test(value)) return ctx.toast('Invalid QR code or session link.','error');
     const {error:e}=await ctx.sb.rpc('attendance_time_in',{p_qr_token:value,p_session_id:null});
     if(e) return ctx.toast(friendlyError(e),'error');
     ctx.toast('Training time in recorded.','success'); resetPortalCache(); await paint();
   }},'Check in with QR');
   body.replaceChildren(el('p',{class:'small muted'},'Attendance is recorded in Philippine time. You must be assigned to the session.'),el('div',{class:'row'},input,checkQr));
   if(!rows.length) body.append(el('p',{class:'muted'},'No training sessions assigned yet.'));
   for(const r of rows) {
     const action=r.time_out ? null : el('button',{class:'btn btn--sm',type:'button',onclick:async()=>{
       const fn=r.time_in?'attendance_time_out':'attendance_time_in';
       const args=r.time_in?{p_session_id:r.id}:{p_session_id:r.id,p_qr_token:null};
       const {error:e}=await ctx.sb.rpc(fn,args);
       if(e) return ctx.toast(friendlyError(e),'error');
       ctx.toast(r.time_in?'Time out recorded.':'Time in recorded.','success'); resetPortalCache(); await paint();
     }},r.time_in?'Time Out':'Time In');
     body.append(el('div',{class:'attendance-session'},
       el('strong',{},r.title),el('span',{class:'small muted'},format(r.starts_at)+' – '+format(r.ends_at)),
       el('span',{class:'small muted'},'Status: '+r.attendance_status+' · In: '+format(r.time_in)+' · Out: '+format(r.time_out)),
       action));
   }
 }
 await paint(); return card;
}
