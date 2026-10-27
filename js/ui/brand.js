// Shared official-logo helpers. The logo is never redrawn; the asset file is never modified.
// Change LOGO_CANDIDATES if the file in assets/images/ has another name.
export const LOGO_CANDIDATES = ['assets/images/ahba-logo.png', 'assets/images/ahba-training-qa-logo.png', 'assets/images/logo.png'];

let logoPromise;
const loadImage = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
export const getLogo = () => (logoPromise ??= (async () => { for (const p of LOGO_CANDIDATES) { const i = await loadImage(p); if (i) return i; } return null; })());

// Render-time keying only: near-white background becomes transparent.
export function keyedLogoCanvas(img) {
  const s = Math.min(1, 1024 / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const m = Math.min(p[i], p[i + 1], p[i + 2]);
    p[i + 3] = Math.round(p[i + 3] * Math.max(0, Math.min(1, (248 - m) / 33)));
  }
  x.putImageData(d, 0, 0);
  return c;
}

// PNG data URL of the keyed logo (sharp on any background), or null when the asset is missing.
let urlPromise;
export const getKeyedLogoUrl = () => (urlPromise ??= getLogo().then((img) => (img ? keyedLogoCanvas(img).toDataURL('image/png') : null)));
