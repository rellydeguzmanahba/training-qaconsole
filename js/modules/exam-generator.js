import { ensureCss } from '../utils/styles.js';
import { el } from '../utils/dom.js';
import { renderExamGenerator } from './training-exam-generator.js';

export function render(root, ctx) {
  ensureCss('css/exam-workspace.css?v=20261030b');
  root.append(
    el('header', { class: 'page-head' },
      el('div', {},
        el('h2', {}, 'AI Exam Generator'),
        el('p', { class: 'muted small' }, 'Create trainer-reviewed exam questions with Gemini AI.'))),
    el('div', { class: 'card', style: 'border-left:4px solid #b49a50' },
      el('strong', {}, 'Draft generation workspace'),
      el('p', { class: 'muted small', style: 'margin:6px 0 0' },
        'Upload documents, save Google Forms links, or generate questions from approved training content. Review all drafts before use. Scheduling and employee exam deployment are not yet available.')));
  renderExamGenerator(root, ctx);
}
