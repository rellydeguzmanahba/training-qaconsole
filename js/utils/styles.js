// Load a stylesheet once, relative to the GitHub Pages application root.
export function ensureCss(path) {
  const url = new URL(path, new URL('../../', import.meta.url)).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.href === url)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
}
