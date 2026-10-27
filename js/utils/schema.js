// Lets the app run both before and after migration 009 (has_lms_account column).
let probe;
export const lmsColumnAvailable = (sb) => (probe ??= sb.from('technicians').select('has_lms_account').limit(1).then((r) => !r.error));
let probeNo;
export const employeeNoAvailable = (sb) => (probeNo ??= sb.from('technicians').select('employee_no').limit(1).then((r) => !r.error));
