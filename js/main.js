import { APP } from './config.js';
import { sb } from './supabase.js';
import { getSession, signIn, signOut, fetchProfile } from './auth.js';
import { renderLogin, renderNotice } from './ui/auth-screens.js';
import { initSidebar } from './ui/sidebar.js';
import { icon } from './ui/icons.js';
import { startRouter, stopRouter, navigate } from './router.js';
import { can } from './permissions.js';
import { toast } from './ui/toast.js';
import { confirmDialog, showModal } from './ui/dialog.js';
import { friendlyError } from './utils/errors.js';

const $ = (id) => document.getElementById(id);
const ROLE_LABEL = { admin: 'Admin', qa: 'QA', trainer: 'Trainer', supervisor: 'Supervisor', viewer: 'Viewer' };

let currentUserId = null;
let idleTimer = null;
let lastActive = Date.now();

function show(which) {
  $('boot').hidden = true;
  $('auth-root').hidden = which !== 'auth';
  $('app').hidden = which !== 'app';
}

function stopSession() {
  stopRouter();
  clearInterval(idleTimer); idleTimer = null;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  $('view').replaceChildren();
}

function showSignedOut() {
  stopSession(); show('auth');
  renderLogin($('auth-root'), { onSubmit: signIn });
}

function startSession(profile) {
  show('app');
  $('user-name').textContent = profile.full_name;
  $('user-role').textContent = ROLE_LABEL[profile.role] || profile.role;
  const out = $('signout');
  out.replaceChildren(icon('logout'));
  out.onclick = () => signOut();
  initSidebar(profile.role);

  const ctx = {
    sb, profile, role: profile.role,
    can: (action) => can(profile.role, action),
    toast, confirm: confirmDialog, showModal, navigate, friendlyError,
  };
  startRouter(ctx);

  lastActive = Date.now();
  clearInterval(idleTimer);
  idleTimer = setInterval(() => {
    if (Date.now() - lastActive > APP.idleMinutes * 60000) {
      toast('Signed out due to inactivity.', 'info');
      signOut();
    }
  }, 30000);
}

async function apply(session) {
  if (!session) { currentUserId = null; return showSignedOut(); }
  if (session.user.id === currentUserId) return;       // token refresh / tab refocus: nothing to redo

  let profile;
  try {
    profile = await fetchProfile(session.user.id);
  } catch (e) {
    console.error(e);
    show('auth');
    renderNotice($('auth-root'), {
      title: 'Could not load your account', message: friendlyError(e),
      actions: [{ label: 'Try again', class: 'btn--primary', onClick: () => apply(session) },
                { label: 'Sign out', onClick: () => signOut() }],
    });
    return;
  }

  currentUserId = session.user.id;
  if (!profile || !profile.active) {
    stopSession(); show('auth');
    renderNotice($('auth-root'), {
      title: 'Account not active',
      message: 'Your account has not been activated yet. Ask an administrator to activate it and assign a role.',
      actions: [{ label: 'Check again', class: 'btn--primary', onClick: () => { currentUserId = null; apply(session); } },
                { label: 'Sign out', onClick: () => signOut() }],
    });
    return;
  }
  startSession(profile);
}

['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) =>
  addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true }));

try {
  await apply(await getSession());
} catch (e) {
  console.error(e);
  $('boot').textContent = 'Could not reach the server. Check your connection and reload.';
}

// Never call Supabase directly inside this callback (deadlock risk) -> defer with setTimeout.
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') setTimeout(() => apply(null), 0);
  else if (event === 'SIGNED_IN') setTimeout(() => apply(session), 0);
});
