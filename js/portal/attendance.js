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
     const camera=el('input',{class:'input',type:'file',accept:'image/*',capture:'user','aria-label':'Take photo'});
     const gallery=el('input',{class:'input',type:'file',accept:'image/jpeg,image/png,image/webp','aria-label':'Choose photo'});
     const preview=el('img',{alt:'Selected attendance photo',style:'display:none;max-width:240px;border-radius:12px'});
     let chosen=null;
     for(const input of [camera,gallery])input.addEventListener('change',()=>{
       chosen=input.files?.[0]||null;
       if(chosen){preview.src=URL.createObjectURL(chosen);preview.style.display='block';}
     });
     const action=r.time_out?null:el('button',{class:'btn btn--sm',type:'button',onclick:async()=>{
       if(r.time_in){
         const {error:e}=await ctx.sb.rpc('attendance_time_out',{p_session_id:r.id});
         if(e)return ctx.toast(friendlyError(e),'error');
         ctx.toast('Time out recorded.','success');resetPortalCache();await paint();return;
       }
       if(!chosen)return ctx.toast('Please submit a photo of yourself attending this training.','error');
       if(!['image/jpeg','image/png','image/webp'].includes(chosen.type)||chosen.size>5242880||!chosen.size)
         return ctx.toast('Photo must be JPG, PNG or WebP, up to 5 MB.','error');
       const {data:{user},error:ue}=await ctx.sb.auth.getUser();
       if(ue||!user)return ctx.toast('Please sign in again.','error');
       const ext=chosen.type==='image/png'?'png':chosen.type==='image/webp'?'webp':'jpg';
       const path=user.id+'/'+r.id+'/'+crypto.randomUUID()+'.'+ext;
       action.disabled=true;action.textContent='Uploading photo…';
       try{
         const {error:up}=await ctx.sb.storage.from('training-attendance').upload(path,chosen,{contentType:chosen.type,upsert:false});
         if(up)throw up;
         const {error:check}=await ctx.sb.rpc('attendance_photo_time_in',{p_session_id:r.id,p_evidence_path:path});
         if(check)throw check;
         ctx.toast('Manual Time In submitted. Pending trainer verification.','success');resetPortalCache();await paint();
       }catch(e){ctx.toast(friendlyError(e),'error');action.disabled=false;action.textContent='Submit Manual Time In';}
     }},r.time_in?'Time Out':'Submit Manual Time In');
     const evidence=r.time_in?null:el('div',{class:'stack'},
       el('p',{class:'small muted'},'A photo of you at the training session is required (maximum 5 MB).'),
       el('label',{},'Take Photo',camera),el('label',{},'Choose from Gallery',gallery),preview);
     body.append(el('div',{class:'attendance-session'},
       el('strong',{},r.title),el('span',{class:'small muted'},format(r.starts_at)+' – '+format(r.ends_at)),
       el('span',{class:'small muted'},'Status: '+r.attendance_status+' · In: '+format(r.time_in)+' · Out: '+format(r.time_out)),
       evidence,r.time_in?el('span',{class:'small muted'},'Verification: '+(r.verification_status||'—')):null,action));
   }
 }
 await paint(); return card;
}
