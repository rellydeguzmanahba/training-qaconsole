import { el } from '../utils/dom.js';
import { friendlyError } from '../utils/errors.js';

// Draft-only workflow. Never auto-publish AI output or expose this view to employee accounts.
export function renderExamGenerator(root, ctx) {
  if (!['admin', 'trainer'].includes(ctx.role)) {
    root.append(el('div', { class: 'card' }, 'Only trainers and administrators can generate exam questions.'));
    return;
  }
  const topic = el('input', { class: 'input', type: 'text', maxlength: '160', placeholder: 'e.g. Fiber Installation and Safety', 'aria-label': 'Training topic' });
  const count = el('input', { class: 'input', type: 'number', min: '1', max: '30', value: '10', 'aria-label': 'Number of questions' });
  const material = el('textarea', { class: 'input', rows: '12', maxlength: '30000', placeholder: 'Paste the training material here (100–30,000 characters). Remove employee personal data and confidential information.', 'aria-label': 'Training material' });
  const status = el('p', { class: 'muted small', role: 'status' });
  const results = el('div', { class: 'stack' });
  const generate = el('button', { class: 'btn btn--primary', type: 'button' }, 'Generate draft questions');
  const note = el('p', { class: 'muted small' }, 'AI output is a draft. Check all answers against approved AHBA training materials. This tool does not publish, schedule, or assign an examination.');
  generate.addEventListener('click', async () => {
    const title = topic.value.trim(), text = material.value.trim(), n = Number(count.value);
    if (!title || text.length < 100 || text.length > 30000 || !Number.isInteger(n) || n < 1 || n > 30) {
      status.textContent = 'Enter a topic, 100–30,000 characters of training material, and 1–30 questions.';
      return;
    }
    generate.disabled = true; status.textContent = 'Generating questions with Gemini…'; results.replaceChildren();
    try {
      const { data, error } = await ctx.sb.functions.invoke('generate-training-exam', {
        body: { topic: title, material: text, count: n },
      });
      if (error) throw error;
      if (!Array.isArray(data?.questions)) throw new Error(data?.error || 'No questions returned.');
      const questions = data.questions;
      const exportBtn = el('button', { class: 'btn', type: 'button' }, 'Export draft JSON');
      exportBtn.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify({ status: 'draft', topic: title, questions }, null, 2)], { type: 'application/json' });
        const href = URL.createObjectURL(blob);
        const a = el('a', { href, download: 'ahba-exam-draft.json' });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
      });
      results.append(el('div', { class: 'row' }, el('strong', {}, `${questions.length} draft questions`), exportBtn));
      questions.forEach((q, i) => {
        const choices = Array.isArray(q.choices) ? q.choices : [];
        results.append(el('article', { class: 'card stack' },
          el('div', { class: 'row' }, el('strong', {}, `${i + 1}. ${q.question || ''}`),
            el('span', { class: 'badge' }, q.difficulty || 'Unrated')),
          el('ol', {}, choices.map((choice, index) =>
            el('li', {}, index === q.correct_index ? el('strong', {}, choice + ' ✓') : choice))),
          el('p', { class: 'small muted' }, `Explanation: ${q.explanation || 'Not provided'}`)));
      });
      status.textContent = 'Draft generated. Review every question before using it in an assessment.';
    } catch (e) {
      console.error('Gemini question generation', e);
      status.textContent = 'Could not generate questions. Verify the function is deployed, JWT access is enabled, and Gemini free-tier quota is available.';
      ctx.toast?.(friendlyError(e), 'error');
    } finally { generate.disabled = false; }
  });
  root.append(el('div', { class: 'stack' },
    el('div', { class: 'card stack' },
      el('h3', {}, 'Gemini AI · Exam Question Generator'),
      el('p', { class: 'muted small' }, 'Create trainer-reviewable multiple-choice questions from approved training content.'),
      el('label', { class: 'stack small' }, 'Training topic', topic),
      el('label', { class: 'stack small' }, 'Number of questions (1–30)', count),
      el('label', { class: 'stack small' }, 'Training content', material),
      note, generate, status),
    results));
}
