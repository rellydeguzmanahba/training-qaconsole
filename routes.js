const ALL = ['admin', 'qa', 'trainer', 'supervisor', 'viewer'];

// module = file in js/modules/<module>.js exporting render(container, ctx) [, destroy()]
export const ROUTES = [
  { path: 'dashboard',   title: 'Dashboard',            icon: 'grid',     module: 'dashboard',   roles: ALL, phase: 11 },
  { path: 'technicians', title: 'Technicians',          icon: 'users',    module: 'technicians', roles: ALL, phase: 6 },
  { path: 'training',    title: 'Training',             icon: 'book',     module: 'training',    roles: ALL, phase: 7 },
  { path: 'violations',  title: 'QA Violations',        icon: 'alert',    module: 'violations',  roles: ALL, phase: 8 },
  { path: 'retraining',  title: 'Retraining',           icon: 'refresh',  module: 'retraining',  roles: ALL, phase: 9 },
  { path: 'offenses',    title: 'Offense Monitoring',   icon: 'shield',   module: 'offenses',    roles: ALL, phase: 10 },
  { path: 'reports',     title: 'Reports',              icon: 'file',     module: 'reports',     roles: ALL, phase: 12 },
  { path: 'import',      title: 'Excel Import',         icon: 'upload',   module: 'import',      roles: ['admin'], phase: 13, group: 'Admin' },
  { path: 'settings',    title: 'Settings',             icon: 'settings', module: 'settings',    roles: ['admin'], phase: 6,  group: 'Admin' },
];
export const DEFAULT_ROUTE = 'dashboard';
