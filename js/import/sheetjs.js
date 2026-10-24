// SheetJS is loaded on demand (only on the Import page) from its official CDN, pinned to an exact version.
// The host is allowed in the Content-Security-Policy of index.html.
const SRC = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
let pending;

export function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  pending ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('The spreadsheet library did not start.')));
    s.onerror = () => { pending = null; reject(new Error('Could not load the spreadsheet library (offline or blocked).')); };
    document.head.append(s);
  });
  return pending;
}
