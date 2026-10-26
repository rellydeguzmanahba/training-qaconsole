// Presentation-level masking. The database still lets every active user read employee rows (see README: restricted-table option).
const CONTACT_ROLES = ['admin', 'qa', 'trainer', 'supervisor'];
export const canSeeContact = (role) => CONTACT_ROLES.includes(role);
export const maskPhone = (s) => (s ? `${s.slice(0, 4)}${'•'.repeat(Math.max(0, s.length - 7))}${s.slice(-3)}` : s);
export const maskEmail = (s) => { if (!s) return s; const [u, d = ''] = s.split('@'); return `${u.slice(0, 1)}•••@${d}`; };
