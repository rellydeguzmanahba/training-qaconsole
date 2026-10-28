const ALL = ['admin', 'qa', 'trainer', 'supervisor', 'viewer'];

// module = file in js/modules/<module>.js exporting render(container, ctx) [, destroy()]
export const ROUTES = [
  { path: 'dashboard',   title: 'Dashboard',            icon: 'grid',     module: 'dashboard',   roles: ALL, group: 'Overview', phase: 11 },
  { path: 'technicians', title: 'Employee Details',      icon: 'users',    module: 'technicians', roles: ALL, group: 'Workforce', phase: 6 },
  { path: 'attendance', title: 'Attendance', icon: 'check', module: 'attendance', roles: ['admin','trainer'], group: 'Workforce', phase: 7 },
  { path: 'training',    title: 'Training',             icon: 'book',     module: 'training',    roles: ALL, group: 'Workforce', phase: 7 },
  { path: 'violations',  title: 'QA Violations',        icon: 'alert',    module: 'violations',  roles: ALL, group: 'Quality & compliance', phase: 8 },
  { path: 'retraining',  title: 'Retraining',           icon: 'refresh',  module: 'retraining',  roles: ALL, group: 'Quality & compliance', phase: 9 },
  { path: 'offenses',    title: 'Offense Monitoring',   icon: 'shield',   module: 'offenses',    roles: ALL, group: 'Quality & compliance', phase: 10 },
  { path: 'reports',     title: 'Reports',              icon: 'file',     module: 'reports',     roles: ALL, group: 'Insights', phase: 12 },
  { path: 'import',      title: 'Excel Import',         icon: 'upload',   module: 'import',      roles: ['admin'], phase: 13, group: 'Admin' },
  { path: 'settings',    title: 'Settings',             icon: 'settings', module: 'settings',    roles: ['admin'], phase: 6,  group: 'Admin' },
];
// Employee accounts use the same sidebar shell as staff, but only personal routes.
export const EMPLOYEE_ROUTES = [
  { path: 'dashboard', title: 'My Dashboard', icon: 'grid', module: 'portal', roles: ['technician'], group: 'My Portal' },
  { path: 'violations', title: 'My Violations', icon: 'alert', module: 'portal', roles: ['technician'], group: 'My Portal' },
  { path: 'monitoring', title: 'My Monitoring', icon: 'refresh', module: 'portal', roles: ['technician'], group: 'My Portal' },
  { path: 'training', title: 'My Training', icon: 'book', module: 'portal', roles: ['technician'], group: 'My Portal' },
];
export const DEFAULT_ROUTE = 'dashboard';
