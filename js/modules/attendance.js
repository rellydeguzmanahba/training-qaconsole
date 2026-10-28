import { el } from '../utils/dom.js';
import { renderAttendanceAdmin } from './training-attendance.js';
export async function render(root,ctx){
 root.append(el('div',{class:'page-head'},el('div',{},el('h2',{},'Training Attendance'),el('p',{class:'muted small'},'Manage sessions, scan QR codes, and verify employee photos — all in one place.'))));
 await renderAttendanceAdmin(root,ctx);
}