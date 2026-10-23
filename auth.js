import { sb } from './supabase.js';

export async function getSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  return data.session;
}

// Returns null on success, or a safe error message.
export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (!error) return null;
  return error.status === 400 || /invalid/i.test(error.message)
    ? 'Invalid email or password.'
    : 'Sign-in failed. Please try again.';
}

export const signOut = () => sb.auth.signOut();

export async function fetchProfile(userId) {
  const { data, error } = await sb.from('profiles')
    .select('user_id, full_name, role, active').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}
