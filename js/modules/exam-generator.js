import { ensureCss } from '../utils/styles.js';
import { el } from '../utils/dom.js';
import { renderExamGenerator } from './training-exam-generator.js?v=20261031exam9';
export function render(root, ctx) {
 ensureCss('css/exam-workspace.css?v=20261031exam9');
 root.append(el('header',{class:'page-head'},el('div',{},el('h2',{},ctx.role==='technician'?'My Examinations':'Examination Management'),el('p',{class:'muted small'},'Question bank, secure randomized assessments, assignments and grading — no AI required.'))));
 renderExamGenerator(root,ctx);
}
