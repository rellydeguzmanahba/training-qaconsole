import { el } from '../utils/dom.js';

export const badge = (text, variant = '') =>
  el('span', { class: `badge${variant ? ` badge--${variant}` : ''}` }, text ?? '—');

export const EMPLOYMENT_VARIANT = { Regular: 'green', Probationary: 'blue', Applicant: '', Resigned: 'amber', Terminated: 'red' };
export const SEVERITY_VARIANT = { Minor: '', Major: 'amber', Critical: 'red' };
export const VIOLATION_STATUS_VARIANT = { Open: 'blue', 'For Retraining': 'amber', Closed: 'green' };
export const RESULT_VARIANT = { Pending: 'amber', Passed: 'green', Failed: 'red' };
export const MONITORING_VARIANT = { BANNED: 'red', 'UNDER MONITORING': 'amber', CLEARED: 'green', 'No offense': '' };

export function deploymentVariant(s = '') {
  if (s === 'BANNED') return 'red';
  if (s.startsWith('ON HOLD') || s.startsWith('Restriction')) return 'amber';
  if (s.includes('under monitoring')) return 'blue';
  return 'green';
}
