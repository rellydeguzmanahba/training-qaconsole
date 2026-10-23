export const newRequestId = () => crypto.randomUUID();   // idempotency key -> client_request_id

// Disable a button while an async action runs (blocks double clicks / double submits).
export async function guarded(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try { return await fn(); }
  finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
}
