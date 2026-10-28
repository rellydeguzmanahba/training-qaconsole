// Dispatcher for the technician portal tabs other than the dashboard.
export async function renderTab(tab, root, ctx) {
  if (tab === 'violations') return (await import('./violations-tab.js')).renderViolations(root, ctx);
  if (tab === 'penalties') return (await import('./penalties-tab.js')).renderPenalties(root, ctx);
  if (tab === 'monitoring') return (await import('./monitoring-tab.js')).renderMonitoring(root, ctx);
  return null;
}
