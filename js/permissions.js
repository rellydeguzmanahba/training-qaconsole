// UI-only convenience. The database (RLS + triggers) is the real enforcement.
const RULES = {
  'technicians:write': ['admin', 'qa', 'trainer'],
  'training:write':    ['admin', 'trainer'],
  'violations:write':  ['admin', 'qa'],
  'retraining:write':  ['admin', 'trainer'],
  'offenses:decide':   ['admin', 'supervisor'],
  'offenses:recalc':   ['admin', 'supervisor', 'qa'],
  'audit:view':        ['admin', 'qa', 'supervisor'],
  'settings:manage':   ['admin'],
  'import:run':        ['admin'],
};
export const can = (role, action) => (RULES[action] || []).includes(role);
