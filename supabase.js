import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

if (!window.supabase?.createClient) {
  throw new Error('Supabase library failed to load (check network / content blockers).');
}

// detectSessionInUrl=false: the hash is used by the app router, not by Auth redirects.
export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
