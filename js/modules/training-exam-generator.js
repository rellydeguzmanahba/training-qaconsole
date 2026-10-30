import { el } from '../utils/dom.js';
import { friendlyError } from '../utils/errors.js';

// Draft-only workflow. Never auto-publish AI output or expose this view to employee accounts.
export function renderExamGenerator(root, ctx) {
  if (!['admin', 'trainer'].includes(ctx.role)) {
    root.append(el('div', { class: 'card' }, 'Only trainers and administrators can generate exam questions.'));
    return;
  }
  const importInput = el('input', { type: 'file', accept: '.pdf,.docx,.xlsx,.xls,.json,.txt,.csv,application/pdf,application/json,text/plain,text/csv', style: 'display:none', 'aria-label': 'Upload existing exam' });
  const importBtn = el('button', { class: 'btn', type: 'button' }, '↑ Upload exam file');
  const importInfo = el('p', { class: 'muted small', role: 'status' },
    'Upload PDF, Word, Excel, or a previously exported exam. Extracted questions must be reviewed before use.');
  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { importInfo.textContent = 'File exceeds 8 MB.'; return; }
    try {
      importInfo.textContent = 'Reading ' + file.name + '…';
      const content = await readExamFile(file);
      if (/\.json$/i.test(file.name)) {
        const parsed = JSON.parse(content);
        const qs = Array.isArray(parsed) ? parsed : parsed.questions;
        if (!Array.isArray(qs) || !qs.length || qs.length > 500) throw new Error('Invalid exam JSON.');
        const valid = qs.every(q => typeof q.question === 'string' && Array.isArray(q.choices) && q.choices.length >= 2 && q.choices.every(a => typeof a === 'string'));
        if (!valid) throw new Error('Questions need text and at least two answer choices.');
        topic.value = String(parsed.topic || file.name.replace(/\.json$/i, '')).slice(0, 160);
        const preview = el('div', { class: 'stack' },
          el('div', { class: 'card' }, el('strong', {}, `${qs.length} imported draft questions`),
            el('p', { class: 'small muted' }, 'Review all questions and confirm answer keys before use. Import does not publish or assign exams.')));
        qs.forEach((q, i) => preview.append(el('div', { class: 'card stack' },
          el('strong', {}, `${i + 1}. ${q.question}`),
          el('ol', {}, q.choices.map((choice, j) => el('li', {}, j === q.correct_index ? `${choice} ✓ (unverified)` : choice))))));
        results.replaceChildren(preview);
        importInfo.textContent = `Loaded ${qs.length} questions from ${file.name} for review.`;
      } else {
        material.value = content.slice(0, 30000);
        topic.value ||= file.name.replace(/\.(txt|csv)$/i, '').slice(0, 160);
        importInfo.textContent = 'Document text loaded. Gemini can generate NEW draft questions from it; original questions are not imported as a verified exam.';
      }
    } catch (error) { importInfo.textContent = error instanceof Error ? error.message : 'Could not read file.'; }
    importInput.value = '';
  });
  const formUrl = el('input', { class: 'input', type: 'url', placeholder: 'Paste a Google Forms link here', 'aria-label': 'Google Forms URL' });
  const saveForm = el('button', { class: 'btn btn--primary', type: 'button' }, 'Save Google Form link');
  const formInfo = el('div', { class: 'stack small' });
  const formKey = 'ahba-exam-form-links';
  function showForms() {
    let links = [];
    try { links = JSON.parse(localStorage.getItem(formKey) || '[]'); } catch {}
    formInfo.replaceChildren(...links.map((link) => el('div', { class: 'exam-workspace__saved-form' },
      el('span', {}, link.title || 'Google Form'),
      el('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer', class: 'btn' }, 'Open form'),
      el('button', { class: 'btn', type: 'button', onclick: () => {
        const updated = links.filter((entry) => entry.url !== link.url);
        localStorage.setItem(formKey, JSON.stringify(updated)); showForms();
      } }, 'Remove'))));
  }
  saveForm.addEventListener('click', () => {
    try {
      const url = new URL(formUrl.value.trim());
      if (url.protocol !== 'https:' || !['docs.google.com', 'forms.gle'].includes(url.hostname) ||
        (url.hostname === 'docs.google.com' && !/^\/forms\//.test(url.pathname))) throw new Error();
      let links = [];
      try { links = JSON.parse(localStorage.getItem(formKey) || '[]'); } catch {}
      if (!links.some((item) => item.url === url.href)) links.push({ title: topic.value.trim() || 'Google Forms examination', url: url.href });
      localStorage.setItem(formKey, JSON.stringify(links.slice(-30)));
      formUrl.value = ''; showForms();
    } catch { formInfo.prepend(el('p', { class: 'muted small' }, 'Enter a valid Google Forms link.')); }
  });
  showForms();
  const topic = el('input', { class: 'input', type: 'text', maxlength: '160', placeholder: 'e.g. Fiber Installation and Safety', 'aria-label': 'Training topic' });
  const count = el('input', { class: 'input', type: 'number', min: '1', max: '30', value: '10', 'aria-label': 'Number of questions' });
  const material = el('textarea', { class: 'input', rows: '9', maxlength: '30000', placeholder: 'Paste the training material here (100–30,000 characters). Remove employee personal data and confidential information.', 'aria-label': 'Training material' });
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
  root.append(el('div', { class: 'stack exam-workspace' },
    el('div', { class: 'card stack exam-workspace__form' },
      el('div', { class: 'exam-workspace__import-panel' },
        el('div', { class: 'exam-workspace__import-choice' }, el('strong', {}, 'Upload an existing exam'), el('p', { class: 'muted small' }, 'PDF · Word · Excel · JSON · TXT · CSV'), importBtn, importInput),
        el('div', { class: 'exam-workspace__import-choice' }, el('strong', {}, 'Use a Google Form'), el('p', { class: 'muted small' }, 'Save a shortcut to your existing exam (on this browser).'), formUrl, saveForm, formInfo)), importInfo,
      el('div', { class: 'exam-workspace__heading' }, el('div', {}, el('span', { class: 'exam-workspace__eyebrow' }, 'QUESTION BUILDER'), el('h3', {}, 'Generate an assessment'), el('p', { class: 'muted small' }, 'Turn approved training materials into a reviewed question bank.'))),
      el('div', { class: 'exam-workspace__fields' }, el('label', { class: 'stack small' }, 'Training topic', topic), el('label', { class: 'stack small' }, 'Questions (1–30)', count)),
      el('label', { class: 'stack small' }, 'Training content', material),
      el('div', { class: 'exam-workspace__actions' }, note, generate), status),
    results));
}

async function loadScript(url, globalName) {
  if (window[globalName]) return window[globalName];
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url; script.onload = resolve; script.onerror = () => reject(new Error('Document reader could not load. Check internet access.'));
    document.head.append(script);
  });
  if (!window[globalName]) throw new Error('Document reader unavailable.');
  return window[globalName];
}
async function readExamFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (['json','txt','csv'].includes(ext)) return file.text();
  if (ext === 'pdf') {
    const pdfjs = await loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js', 'pdfjsLib');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer(), disableWorker: true }).promise;
    if (pdf.numPages > 80) throw new Error('PDF exceeds 80 pages.');
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const text = await page.getTextContent();
      pages.push(text.items.map((item) => item.str || '').join(' '));
    }
    const output = pages.join('\n');
    if (output.trim().length < 100) throw new Error('This PDF has no extractable text. Please use a text-based PDF.');
    return output;
  }
  if (ext === 'docx') {
    const mammoth = await loadScript('https://cdn.jsdelivr.net/npm/mammoth@1.9.1/mammoth.browser.min.js', 'mammoth');
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value || '';
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const XLSX = await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', 'XLSX');
    const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return book.SheetNames.map((name) => XLSX.utils.sheet_to_csv(book.Sheets[name])).join('\n');
  }
  throw new Error('Unsupported file type.');
}
