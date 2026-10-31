import { APP } from './config.js';
import { sb } from './supabase.js';
import { getSession, signIn, signOut, fetchProfile } from './auth.js';
import { renderLogin, renderNotice } from './ui/auth-screens.js';
import { initSidebar } from './ui/sidebar.js';
import { icon } from './ui/icons.js';
import { startRouter, stopRouter, navigate } from './router.js?v=20261031exam7';
import { can } from './permissions.js';
import { toast } from './ui/toast.js';
import { confirmDialog, showModal } from './ui/dialog.js';
import { friendlyError } from './utils/errors.js';
import { initPwa } from './pwa/register.js';
import { clearAllData } from './pwa/offline-store.js';
import { resetPortalCache } from './portal/data.js';

const $ = (id) => document.getElementById(id);
const ROLE_LABEL = { technician: 'Employee', admin: 'Admin', qa: 'QA', trainer: 'Trainer', supervisor: 'Supervisor', viewer: 'Viewer' };

let clockTimer = null;
function startClock() {
  clearInterval(clockTimer);
  const host = document.querySelector('#sidebar');
  if (!host) return;
  let clock = document.getElementById('ahba-live-clock');
  if (!clock) {
    clock = document.createElement('div'); clock.id = 'ahba-live-clock'; clock.className = 'sidebar__clock';
    clock.setAttribute('role', 'timer'); clock.setAttribute('aria-label', 'Philippine time');
    clock.innerHTML = '<span class="sidebar__clock-time"></span><span class="sidebar__clock-date"></span>';
    host.insertBefore(clock, host.querySelector('.sidebar__user') || host.querySelector('.sidebar__collapse'));
  }
  const timeFmt = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour:'numeric', minute:'2-digit', second:'2-digit', hour12:true });
  const dateFmt = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday:'short', month:'short', day:'numeric', year:'numeric' });
  const tick = () => { const now = new Date(); clock.querySelector('.sidebar__clock-time').textContent = timeFmt.format(now); clock.querySelector('.sidebar__clock-date').textContent = dateFmt.format(now); };
  tick(); clockTimer = setInterval(tick, 1000);
}
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
  clearInterval(clockTimer); clockTimer = null;
  clearInterval(idleTimer); idleTimer = null;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  $('view').replaceChildren();
}

function showSignedOut() {
  resetPortalCache();
  void clearAllData();
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
  startClock();

  const ctx = {
    sb, profile, role: profile.role,
    can: (action) => can(profile.role, action),
    toast, confirm: confirmDialog, showModal, navigate, friendlyError,
  };
  initPwa(profile.role);
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
