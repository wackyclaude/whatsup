// "Sign in with Google" — the standard OAuth 2.0 web-server flow with PKCE.
//
// Scopes: your email address (to check you're on the allow-list) and
// read-only access to your calendars. Nothing else.

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly'];
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export class SignInError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code; // shown to the user as a short reason
  }
}

export function buildAuthUrl({ clientId, redirectUri, state, codeChallenge, loginHint }) {
  const qs = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline', // gives a refresh token, so you stay signed in
    prompt: 'consent select_account',
    include_granted_scopes: 'false',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  if (loginHint) qs.set('login_hint', loginHint);
  return `${AUTH_URL}?${qs}`;
}

function decodeJwtPayload(jwt) {
  const part = String(jwt || '').split('.')[1];
  if (!part) throw new SignInError('failed', 'no id_token');
  const pad = '='.repeat((4 - (part.length % 4)) % 4);
  return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/') + pad));
}

/**
 * Swaps the one-time code for tokens. The ID token comes straight from
 * Google's token endpoint over TLS, so (per OpenID Connect) its claims can
 * be trusted without a separate signature check; we still check the
 * audience, issuer, expiry and that the email is verified.
 */
export async function exchangeCode({ code, codeVerifier, clientId, clientSecret, redirectUri }, fetchImpl = fetch, nowSec = Math.floor(Date.now() / 1000)) {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, code_verifier: codeVerifier, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) throw new SignInError('failed', `token exchange HTTP ${res.status}`);
  const body = await res.json();
  const granted = String(body.scope || '').split(' ');
  if (!granted.includes('https://www.googleapis.com/auth/calendar.readonly')) {
    throw new SignInError('no_calendar', 'calendar permission not granted');
  }
  if (!body.refresh_token) throw new SignInError('failed', 'no refresh token');
  const claims = decodeJwtPayload(body.id_token);
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(clientId)) throw new SignInError('failed', 'wrong audience');
  if (!ISSUERS.includes(claims.iss)) throw new SignInError('failed', 'wrong issuer');
  if (typeof claims.exp !== 'number' || claims.exp < nowSec - 60) throw new SignInError('failed', 'expired id_token');
  if (!claims.email || claims.email_verified !== true) throw new SignInError('failed', 'email not verified');
  return {
    email: String(claims.email).toLowerCase(),
    refreshToken: body.refresh_token,
    accessToken: body.access_token,
    expiresIn: body.expires_in || 3600,
  };
}

// Short-lived access tokens, kept in memory per refresh token.
const accessCache = new Map();

export async function accessTokenFor(refreshToken, { clientId, clientSecret }, fetchImpl = fetch, nowMs = Date.now()) {
  const hit = accessCache.get(refreshToken);
  if (hit && nowMs < hit.expiresAt - 120000) return hit.token;
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token',
    }).toString(),
  });
  if (res.status === 400 || res.status === 401) {
    let err = '';
    try { err = (await res.json()).error || ''; } catch (e) { /* ignore */ }
    if (err === 'invalid_grant' || res.status === 401) throw new SignInError('expired', 'Google sign-in expired or was revoked');
  }
  if (!res.ok) throw new Error(`Google token refresh HTTP ${res.status}`);
  const body = await res.json();
  if (accessCache.size > 50) accessCache.clear();
  accessCache.set(refreshToken, { token: body.access_token, expiresAt: nowMs + (body.expires_in || 3600) * 1000 });
  return body.access_token;
}

/** Forget a cached access token (e.g. Google rejected it). */
export function dropAccessToken(refreshToken) {
  accessCache.delete(refreshToken);
}

export function rememberAccessToken(refreshToken, token, expiresIn, nowMs = Date.now()) {
  accessCache.set(refreshToken, { token, expiresAt: nowMs + expiresIn * 1000 });
}

export async function revoke(refreshToken, fetchImpl = fetch) {
  accessCache.delete(refreshToken);
  try {
    await fetchImpl(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    });
  } catch (e) {
    // best effort
  }
}

export function _resetOAuthCache() {
  accessCache.clear();
}
