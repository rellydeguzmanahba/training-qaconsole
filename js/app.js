// AHBA boot loader. Keep this dependency-free so startup failures can be diagnosed and recovered.
if (window.top !== window.self) {
  document.documentElement.textContent = '';
  throw new Error('Framing is not allowed.');
}

function showBootFailure(error) {
  console.error('[AHBA startup]', error);
  const boot = document.getElementById('boot');
  if (!boot) return;
  const msg = error && (error.message || String(error)) || 'Unknown startup error';
  boot.hidden = false;
  boot.replaceChildren();
  const box = document.createElement('div');
  box.style.cssText = 'max-width:440px;margin:auto;padding:28px 22px;text-align:center;color:#183c30;font:14px/1.5 system-ui,sans-serif';
  const heading = document.createElement('h2');
  heading.textContent = 'Unable to start AHBA Console';
  heading.style.cssText = 'font-size:19px;margin:0 0 9px';
  const explanation = document.createElement('p');
  explanation.textContent = 'An application file failed to load. Your records are safe. Try refreshing the app files below.';
  const detail = document.createElement('p');
  detail.textContent = 'Error: ' + msg;
  detail.style.cssText = 'font-size:12px;overflow-wrap:anywhere;color:#a04435;background:#fff1ed;padding:10px;border-radius:8px';
  const button = document.createElement('button');
  button.textContent = 'Repair and reload app';
  button.style.cssText = 'border:0;border-radius:9px;background:#086747;color:white;padding:12px 18px;font-weight:700;cursor:pointer';
  button.onclick = async () => {
    button.disabled = true;
    button.textContent = 'Refreshing app files…';
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.filter(r => r.scope.includes('/training-qaconsole/')).map(r => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith('ahba-')).map(k => caches.delete(k)));
      }
    } catch (e) { console.warn('Cache repair partially completed',e); }
    const url = new URL(location.href);
    url.searchParams.set('refresh', String(Date.now()));
    location.replace(url.href);
  };
  box.append(heading, explanation, detail, button);
  boot.append(box);
}

import('./main.js?v=20261031exam6').catch(showBootFailure);
