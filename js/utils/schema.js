// Lets the app run both before and after migration 009 (has_lms_account column).
let probe;
export const lmsColumnAvailable = (sb) => (probe ??= sb.from('technicians').select('has_lms_account').limit(1).then((r) => !r.error));
