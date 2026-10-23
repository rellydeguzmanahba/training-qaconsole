// Tiny loader: reports startup failures (blocked CDN, syntax error) instead of an endless "Loading…".
import('./main.js').catch((e) => {
  console.error(e);
  const boot = document.getElementById('boot');
  if (boot) boot.textContent = 'The app could not start. Check your connection or content blocker, then reload.';
});
