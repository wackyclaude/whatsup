// Sign-in page: shows why you're here (if a sign-in failed) and whether the
// app has been set up yet. All text is inserted as plain text.

const MESSAGES = {
  denied: 'Sign-in was cancelled.',
  not_allowed: 'That Google account isn’t on this dashboard’s list. Ask the person who set it up to add it.',
  no_calendar: 'Please tick the “See your calendars” box when Google asks — the dashboard needs it to show your events.',
  expired: 'You’ve been signed out. Please sign in again.',
  failed: 'Sign-in didn’t work. Please try again.',
};

const params = new URLSearchParams(location.search);
const reason = params.get('error') || params.get('signin');
if (reason && MESSAGES[reason]) {
  const msg = document.getElementById('signin-msg');
  msg.textContent = MESSAGES[reason];
  msg.hidden = false;
}
if (reason) history.replaceState(null, '', '/');

fetch('/api/status', { cache: 'no-store' })
  .then((r) => r.json())
  .then((s) => {
    if (s.ready) return;
    const box = document.getElementById('setup');
    box.textContent = `Setup isn’t finished yet. Still needed in Cloudflare: ${s.missing.join(', ')}.`;
    box.hidden = false;
    document.getElementById('signin-btn').setAttribute('aria-disabled', 'true');
  })
  .catch(() => {});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
