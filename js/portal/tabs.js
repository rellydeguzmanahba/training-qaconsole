// Dispatcher for the technician portal tabs other than the dashboard.
export async function renderTab(tab, root, ctx) {
  if (tab === 'violations') return (await import('./violations-tab.js')).renderViolations(root, ctx);
  if (tab === 'training') return (await import('./training-tab.js')).renderTraining(root, ctx);
  if (tab === 'monitoring') return (await import('./monitoring-tab.js')).renderMonitoring(root, ctx);
  return null;
}
