// Keyboard support shared by every tab strip: Left/Right/Home/End move between tabs (WAI-ARIA tabs pattern).
let installed = false;
export function installTabKeys() {
  if (installed) return;
  installed = true;
  document.addEventListener('keydown', (e) => {
    const tab = e.target.closest?.('[role="tab"]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')];
    const i = tabs.indexOf(tab);
    const next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    e.preventDefault(); next.focus(); next.click();
  });
}
