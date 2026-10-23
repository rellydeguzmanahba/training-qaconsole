export const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
export const isMobile = (s) => /^[0-9+][0-9 -]{6,19}$/.test(s);       // mirrors the DB check
// Mirrors technicians.name_key in the database (first + surname, case/space-insensitive).
export const nameKey = (first, surname) => `${first} ${surname}`.trim().replace(/\s+/g, ' ').toLowerCase();
export const ordinal = (n) => ['', '1st', '2nd', '3rd', '4th', '5th'][n] || `${n}th`;
