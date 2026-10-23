// columns: [{ key, label }]. Rows hold plain values. Cells starting with = + - @ are neutralised
// so spreadsheet apps cannot execute them as formulas (CSV injection).
const FORMULA = /^[=+\-@\t\r]/;

export function toCSV(columns, rows) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (typeof v !== 'number' && FORMULA.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => cell(c.label)).join(','), ...rows.map((r) => columns.map((c) => cell(r[c.key])).join(','))].join('\r\n');
}

export function downloadCSV(filename, text) {
  const blob = new Blob(['\ufeff', text], { type: 'text/csv;charset=utf-8' });   // BOM keeps Excel happy with UTF-8
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
