// Interactive 3D hero for the admin dashboard. Three.js is loaded on demand (pinned version, jsDelivr).
// Modes: full (desktop WebGL) | lite (touch/tablet: slower, no pointer tracking) | fallback (CSS only: phones, low-end, reduced motion, no WebGL).
import { el } from '../utils/dom.js';

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
// The official logo is never redrawn. Change this list if the file in assets/images/ has another name.
export const LOGO_CANDIDATES = ['assets/images/ahba-logo.png', 'assets/images/ahba-training-qa-logo.png', 'assets/images/logo.png'];

let logoPromise;
const loadImage = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
const getLogo = () => (logoPromise ??= (async () => { for (const p of LOGO_CANDIDATES) { const i = await loadImage(p); if (i) return i; } return null; })());

function pickMode() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lowEnd = (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2);
  if (reduced || lowEnd || innerWidth < 720) return 'fallback';
  return matchMedia('(pointer: coarse)').matches ? 'lite' : 'full';
}

// Render-time keying only: near-white background becomes transparent. The asset file itself is unchanged.
function keyedLogoCanvas(img) {
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

function glowCanvas() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d'), g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(15,122,82,.30)'); g.addColorStop(.55, 'rgba(15,122,82,.10)'); g.addColorStop(1, 'rgba(15,122,82,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  return c;
}

function waitConnected(node, ctl) {
  return new Promise((resolve) => {
    let n = 0;
    const tick = () => { if (ctl.destroyed || node.isConnected || ++n > 180) resolve(); else requestAnimationFrame(tick); };
    tick();
  });
}

function renderFallback(container, img) {
  container.replaceChildren(el('div', { class: 'hero-fallback' }, el('span', { class: 'ring' }), el('span', { class: 'ring' }),
    img ? el('img', { src: img.src, alt: 'AHBA Development Training & QA', width: img.naturalWidth, height: img.naturalHeight, decoding: 'async' }) : null));
}

export function mountHero(container) {
  const ctl = { destroyed: false, cleanup: [] };
  (async () => {
    await waitConnected(container, ctl);
    if (ctl.destroyed) return;
    const mode = pickMode(), logo = await getLogo();
    if (ctl.destroyed) return;
    if (mode === 'fallback') return renderFallback(container, logo);
    let THREE;
    try { THREE = await import(THREE_URL); } catch (e) { console.warn('Three.js unavailable, using fallback', e); return renderFallback(container, logo); }
    if (ctl.destroyed) return;
    try { startScene(THREE, container, logo, mode, ctl); } catch (e) { console.warn('3D hero failed, using fallback', e); ctl.cleanup.splice(0).reverse().forEach((f) => { try { f(); } catch { /* ignore */ } }); renderFallback(container, logo); }
  })();
  return {
    destroy() {
      ctl.destroyed = true;
      ctl.cleanup.splice(0).reverse().forEach((f) => { try { f(); } catch { /* ignore */ } });
      container.replaceChildren();
    },
  };
}

function startScene(T, container, logo, mode, ctl) {
  const lite = mode === 'lite';
  const w = container.clientWidth || 560, h = container.clientHeight || 300;
  const renderer = new T.WebGLRenderer({ alpha: true, antialias: !lite, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1.25 : 1.75));
  renderer.setSize(w, h, false);
  renderer.setClearColor(0x000000, 0);
  container.replaceChildren(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(38, w / h, 0.1, 50);
  camera.position.set(0, 0, 9.2);
  const group = new T.Group(); scene.add(group);

  const fade = [];                                       // materials that fade in with the entrance
  const addFade = (mat, max) => { mat.transparent = true; mat.opacity = 0; fade.push([mat, max]); return mat; };
  const COLORS = [0x0f7a52, 0xb8963e, 0x2da36f];

  // soft glow
  const glowTex = new T.CanvasTexture(glowCanvas());
  const glow = new T.Mesh(new T.PlaneGeometry(7.2, 7.2), addFade(new T.MeshBasicMaterial({ map: glowTex, depthWrite: false }), 1));
  glow.position.z = -0.6; group.add(glow);

  // emblem (official logo, keyed at render time). Without the asset we show rings only: nothing is invented.
  let emblem = null;
  if (logo) {
    const tex = new T.CanvasTexture(keyedLogoCanvas(logo));
    tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
    const ew = 4.1, eh = ew * (logo.naturalHeight / logo.naturalWidth);
    emblem = new T.Mesh(new T.PlaneGeometry(ew, eh), addFade(new T.MeshBasicMaterial({ map: tex, side: T.DoubleSide, depthWrite: false }), 1));
    group.add(emblem);
  }

  // orbital rings with data nodes
  const rings = [[2.5, 1.2, 0.2, 0.18, 0], [3.0, 0.9, -0.5, -0.12, 1], [3.5, 1.45, 0.9, 0.08, 2]].map(([r, tx, ty, speed, ci], k) => {
    const g = new T.Group(); g.rotation.set(tx, ty, 0);
    g.add(new T.Mesh(new T.TorusGeometry(r, 0.012, 8, lite ? 80 : 128), addFade(new T.MeshBasicMaterial({ color: COLORS[ci] }), 0.5)));
    const nodes = Array.from({ length: 4 }, (_, i) => {
      const m = new T.Mesh(new T.SphereGeometry(i % 2 ? 0.055 : 0.085, 12, 12), addFade(new T.MeshBasicMaterial({ color: COLORS[(ci + i) % 3] }), 0.95));
      g.add(m); return { m, a: (i / 4) * Math.PI * 2 + k, s: (0.25 + i * 0.07) * (k % 2 ? -1 : 1) };
    });
    group.add(g);
    return { g, r, speed, nodes };
  });

  // pointer + animation state
  const target = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
  const onMove = (e) => {
    if (e.pointerType === 'touch') return;
    const b = container.getBoundingClientRect();
    target.x = Math.max(-1, Math.min(1, (e.clientX - (b.left + b.width / 2)) / (innerWidth / 2)));
    target.y = Math.max(-1, Math.min(1, (e.clientY - (b.top + b.height / 2)) / (innerHeight / 2)));
    if (!raf) start();
  };
  const onLeave = () => { target.x = target.y = 0; };
  if (!lite) { window.addEventListener('pointermove', onMove, { passive: true }); document.documentElement.addEventListener('mouseleave', onLeave); window.addEventListener('blur', onLeave); }

  let raf = 0, last = performance.now(), lastDraw = 0, t0 = last, inView = true;
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (lite && now - lastDraw < 33) return;             // ~30 fps on touch devices
    lastDraw = now;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = (now - t0) / 1000;
    const e = Math.min(1, t / 1.4), ease = 1 - Math.pow(1 - e, 3);
    group.scale.setScalar(0.62 + 0.38 * ease);
    for (const [m, max] of fade) m.opacity = ease * max;
    if (lite) { target.x = Math.sin(t * 0.45) * 0.5; target.y = Math.cos(t * 0.35) * 0.25; }
    const k = Math.min(1, dt * 5);                        // smooth, spring-like follow
    cur.x += (target.x - cur.x) * k; cur.y += (target.y - cur.y) * k;
    group.rotation.y = cur.x * 0.5; group.rotation.x = -cur.y * 0.32 + Math.sin(t * 0.6) * 0.03;
    group.position.y = Math.sin(t * 0.9) * 0.09;
    for (const rg of rings) {
      rg.g.rotation.z += dt * rg.speed;
      for (const n of rg.nodes) { n.a += dt * n.s; n.m.position.set(Math.cos(n.a) * rg.r, Math.sin(n.a) * rg.r, 0); }
    }
    renderer.render(scene, camera);
    // idle: once entrance is done and the pointer rests, keep animating only gently (rings still move) -> no early stop
  };
  const start = () => { if (!raf && inView && !document.hidden && !ctl.destroyed) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };

  const io = new IntersectionObserver((en) => { inView = en[0].isIntersecting; inView ? start() : stop(); });
  io.observe(container);
  const onVis = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVis);
  const ro = new ResizeObserver(() => {
    const cw = container.clientWidth, ch = container.clientHeight;
    if (!cw || !ch) return;
    renderer.setSize(cw, ch, false); camera.aspect = cw / ch; camera.position.z = cw < 480 ? 11 : 9.2; camera.updateProjectionMatrix();
  });
  ro.observe(container);
  const onLost = (e) => { e.preventDefault(); stop(); renderFallback(container, logo); };
  renderer.domElement.addEventListener('webglcontextlost', onLost);

  ctl.cleanup.push(() => {
    stop(); io.disconnect(); ro.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('pointermove', onMove); window.removeEventListener('blur', onLeave);
    document.documentElement.removeEventListener('mouseleave', onLeave);
    renderer.domElement.removeEventListener('webglcontextlost', onLost);
    scene.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  });
  start();
}
