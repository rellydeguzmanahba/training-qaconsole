import { el } from '../utils/dom.js';
import { guarded } from '../utils/submit.js';
import { friendlyError } from '../utils/errors.js';
import { isEmail, isMobile } from '../utils/validate.js';

// field: { name, label, type: text|email|tel|date|number|select|textarea|checkbox|checks,
//          required: bool | (values)=>bool, visible?: (values)=>bool, options?, hint?, maxlength?, min?, max?, disabled? }

function makeInput(f, value) {
  const id = `f_${f.name}`;
  if (f.type === 'select') {
    const s = el('select', { class: 'input', id, name: f.name, disabled: f.disabled });
    s.append(el('option', { value: '' }, '— Select —'));
    for (const o of f.options || []) s.append(el('option', { value: String(o.value) }, o.label));
    s.value = value == null ? '' : String(value);
    return s;
  }
  if (f.type === 'textarea') {
    const t = el('textarea', { class: 'input', id, name: f.name, rows: 3, maxlength: f.maxlength || 1000, disabled: f.disabled });
    t.value = value ?? '';
    return t;
  }
  if (f.type === 'file') return el('input', { class: 'input', type: 'file', id, name: f.name, accept: f.accept });
  if (f.type === 'checkbox') {
    const c = el('input', { type: 'checkbox', id, name: f.name, disabled: f.disabled });
    c.checked = !!value;
    return c;
  }
  if (f.type === 'checks') {
    const set = new Set((value || []).map(String));
    const labels = [];
    const box = el('div', { class: f.scroll ? 'checks--scroll' : 'row', role: 'group', 'aria-label': f.label });
    for (const o of f.options || []) {
      const cb = el('input', { type: 'checkbox', value: String(o.value) });
      cb.checked = set.has(String(o.value));
      const lab = el('label', { class: 'row small', style: 'gap:6px;font-weight:400' }, cb, o.label);
      labels.push([lab, cb, String(o.label).toLowerCase()]);
      box.append(lab);
    }
    if (!f.scroll) return box;
    // long lists: filter box + select all / clear (only visible rows are affected)
    const q = el('input', { class: 'input', type: 'search', placeholder: 'Filter…', 'aria-label': `Filter ${f.label}` });
    q.addEventListener('input', () => { const t = q.value.trim().toLowerCase(); labels.forEach(([l, , txt]) => { l.hidden = !!t && !txt.includes(t); }); });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    const setVisible = (on) => labels.forEach(([l, cb]) => { if (!l.hidden) cb.checked = on; });
    const wrap = el('div', { class: 'stack', style: 'gap:8px' },
      el('div', { class: 'row' }, q,
        el('button', { type: 'button', class: 'btn btn--sm', onclick: () => { setVisible(true); wrap.dispatchEvent(new Event('change', { bubbles: true })); } }, 'Select shown'),
        el('button', { type: 'button', class: 'btn btn--sm', onclick: () => { setVisible(false); wrap.dispatchEvent(new Event('change', { bubbles: true })); } }, 'Clear shown')),
      box);
    return wrap;
  }
  const i = el('input', { class: 'input', type: f.type || 'text', id, name: f.name, maxlength: f.maxlength,
    min: f.min, max: f.max, step: f.step, autocomplete: 'off', disabled: f.disabled });
  i.value = value ?? '';
  return i;
}

function readValue(f, node) {
  switch (f.type) {
    case 'file': return node.files?.[0] || null;
    case 'checkbox': return node.checked;
    case 'checks': return [...node.querySelectorAll('input:checked')].map((i) => i.value);
    case 'number': { const v = node.value.trim(); return v === '' ? null : Number(v); }
    default: { const v = String(node.value ?? '').trim().replace(/[ \t]+/g, ' '); return v === '' ? null : v; }
  }
}

// Opens a modal form. Resolves { result } after a successful save, or null if cancelled.
// onSubmit(values) may throw UserError(message, {field: msg}) or a Supabase error; the modal stays open.
export function formModal({ title, fields, values = {}, submitText = 'Save', wide = false, intro = null, validate = null, onSubmit }) {
  return new Promise((resolve) => {
    const nodes = {}, wraps = {}, errEls = {}, stars = {};
    const alertBox = el('div', { class: 'alert alert--error', role: 'alert', hidden: true });
    const grid = el('div', { class: 'form-grid' });

    for (const f of fields) {
      const node = makeInput(f, values[f.name]);
      nodes[f.name] = node;
      errEls[f.name] = el('div', { class: 'field__error', hidden: true });
      stars[f.name] = el('span', { class: 'field__error', 'aria-hidden': 'true' }, ' *');
      const label = f.type === 'checkbox'
        ? el('label', { class: 'row', style: 'font-weight:400;gap:8px' }, node, f.label)
        : el('label', { for: f.type === 'checks' ? null : `f_${f.name}` }, f.label, stars[f.name]);
      wraps[f.name] = el('div', { class: 'field' }, label, f.type === 'checkbox' ? null : node,
        f.hint ? el('div', { class: 'small muted' }, f.hint) : null, errEls[f.name]);
      grid.append(wraps[f.name]);
    }

    const collect = () => {
      const v = {};
      for (const f of fields) v[f.name] = readValue(f, nodes[f.name]);
      return v;
    };
    const isVisible = (f, v) => (f.visible ? f.visible(v) : true);
    const isReq = (f, v) => (typeof f.required === 'function' ? f.required(v) : !!f.required);

    const refresh = () => {
      const v = collect();
      for (const f of fields) {
        wraps[f.name].hidden = !isVisible(f, v);
        stars[f.name].hidden = !isReq(f, v);
      }
    };

    const showErrors = (errors) => {
      for (const f of fields) {
        const m = errors?.[f.name];
        errEls[f.name].textContent = m || '';
        errEls[f.name].hidden = !m;
      }
      const first = fields.find((f) => errors?.[f.name]);
      if (first) (nodes[first.name].focus ? nodes[first.name] : nodes[first.name].querySelector('input'))?.focus();
    };

    const check = (v) => {
      const errors = {};
      for (const f of fields) {
        if (!isVisible(f, v)) { v[f.name] = f.type === 'checks' ? [] : (f.type === 'checkbox' ? false : null); continue; }
        const val = v[f.name];
        const empty = val == null || val === '' || (Array.isArray(val) && !val.length);
        if (isReq(f, v) && empty && f.type !== 'checkbox') { errors[f.name] = 'This field is required.'; continue; }
        if (empty) continue;
        if (f.type === 'email' && !isEmail(val)) errors[f.name] = 'Enter a valid email address.';
        if (f.type === 'tel' && !isMobile(val)) errors[f.name] = 'Enter a valid mobile number (digits, +, spaces or dashes).';
        if (f.type === 'number' && (Number.isNaN(val) || (f.min != null && val < f.min) || (f.max != null && val > f.max))) {
          errors[f.name] = `Enter a number${f.min != null ? ` from ${f.min}` : ''}${f.max != null ? ` to ${f.max}` : ''}.`;
        }
      }
      return { ...(validate ? validate(v) : {}), ...errors };
    };

    let result;
    const cancelBtn = el('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel');
    const submitBtn = el('button', { type: 'submit', class: 'btn btn--primary' }, submitText);
    const form = el('form', { novalidate: true },
      el('div', { class: 'modal__body' }, el('h2', {}, title), intro, alertBox, grid),
      el('div', { class: 'modal__actions' }, cancelBtn, submitBtn));
    const dlg = el('dialog', { class: `modal${wide ? ' modal--wide' : ''}`, 'aria-label': title }, form);

    form.addEventListener('input', refresh);
    form.addEventListener('change', refresh);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      alertBox.hidden = true;
      const v = collect();
      const errors = check(v);
      showErrors(errors);
      if (Object.keys(errors).length) return;
      guarded(submitBtn, async () => {
        try {
          result = await onSubmit(v);
          dlg.close('saved');
        } catch (err) {
          if (err?.fieldErrors) showErrors(err.fieldErrors);
          const msg = friendlyError(err);
          if (msg) { alertBox.textContent = msg; alertBox.hidden = false; }
        }
      });
    });
    dlg.addEventListener('close', () => { const ok = dlg.returnValue === 'saved'; dlg.remove(); resolve(ok ? { result } : null); });

    document.body.append(dlg);
    refresh();
    dlg.showModal();
    form.querySelector('input:not([type=checkbox]),select,textarea')?.focus();
  });
}
