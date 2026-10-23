// Turn Supabase/Postgres errors into short, user-safe messages.
export function friendlyError(err) {
  if (!err) return 'Something went wrong.';
  if (err.code === 'CONFLICT') return err.message;
  switch (err.code) {
    case '23505': return 'A record with the same details already exists.';
    case '23503': return 'This record is linked to other records and cannot be changed or removed.';
    case '23502': return 'A required field is missing.';
    case '23514': return 'One of the values is not allowed.';
    case '42501': return 'You do not have permission to do this.';
    case 'PGRST116': return 'The record was not found or was changed by someone else.';
    case 'P0001': return err.message;            // messages raised by our own triggers/functions
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(err.message || '')) return 'Network problem. Check your connection and try again.';
  return 'Something went wrong. Please try again.';
}
