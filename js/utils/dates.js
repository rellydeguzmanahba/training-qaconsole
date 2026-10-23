import { APP } from '../config.js';

const dateFmt = new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
const dtFmt = new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: APP.timezone });

// Date-only strings ('YYYY-MM-DD') are formatted in UTC so they never shift a day.
export function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(String(v).length === 10 ? `${v}T00:00:00Z` : v);
  return isNaN(d) ? '—' : dateFmt.format(d);
}
export function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d) ? '—' : dtFmt.format(d);
}
export const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: APP.timezone }).format(new Date());
