// Clickjacking defence: GitHub Pages cannot set frame-ancestors, so refuse to run inside another site's frame.
if (window.top !== window.self) {
  document.documentElement.textContent = '';
  throw new Error('Framing is not allowed.');
}

// Tiny loader: reports startup failures (blocked CDN, syntax error) instead of an endless "Loading…".
import('./main.js?v=20261029m').catch((e) => {
  console.error(e);
  const boot = document.getElementById('boot');
  if (boot) boot.textContent = 'The app could not start. Check your connection or content blocker, then reload.';
});
