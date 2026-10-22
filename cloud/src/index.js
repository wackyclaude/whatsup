// Whatsup family dashboard — Cloudflare Worker (a standard web app).
//
//  /                 the dashboard if you're signed in, otherwise the sign-in page
//  /login            starts "Sign in with Google"
//  /auth/callback    Google sends you back here
//  /logout  (POST)   signs out and revokes the app's Google access
//  /api/settings     page settings (signed in only)
//  /api/data         calendar + weather (signed in only)
//
// Only Google accounts listed in WHATSUP_CONFIG.allowed_emails can sign in.

import { loadConfig, publicSettings } from './config.js';
import { getData, forgetUser, VERSION } from './data.js';
import {
  buildAuthUrl, exchangeCode, rememberAccessToken, revoke, SignInError,
} from './oauth.js';
import {
  SESSION_COOKIE, OAUTH_COOKIE, SESSION_DAYS, seal, unseal, readCookie, cookie, clearCookie,
  randomToken, sha256b64url, secretOk,
} from './session.js';
import festivalsFile from '../../config/festivals.json' with { type: 'json' };

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
  "connect-src 'self'", "font-src 'self'", "manifest-src 'self'", "worker-src 'self'",
  "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  'frame-src https://www.youtube-nocookie.com https://www.youtube.com',
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Robots-Tag': 'noindex, nofollow',
  'Strict-Transport-Security': 'max-age=31536000',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

const FESTIVALS = (festivalsFile.festivals || [])
  .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(String(f.date)) && f.name)
  .map((f) => ({ date: f.date, name: String(f.name).slice(0, 40) }));

function withHeaders(response, extra = {}) {
  const res = new Response(response.body, response);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) res.headers.set(k, v);
  return res;
}

function json(obj, status = 200, extra = {}) {
  return withHeaders(new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  }), extra);
}

function text(body, status) {
  return withHeaders(new Response(body, {
    status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  }));
}

function redirect(location, cookies = []) {
  const res = new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
  for (const c of cookies) res.headers.append('Set-Cookie', c);
  return withHeaders(res, { 'Referrer-Policy': 'no-referrer' });
}

/** What's missing before anyone can sign in (names only, never values). */
function missingSettings(env) {
  const missing = [];
  if (!env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
  if (!env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
  if (!secretOk(env.SESSION_SECRET)) missing.push('SESSION_SECRET (at least 32 characters)');
  return missing;
}

async function currentSession(request, env, config) {
  const data = await unseal(env.SESSION_SECRET, 'session', readCookie(request, SESSION_COOKIE));
  if (!data || typeof data.email !== 'string' || typeof data.rt !== 'string') return null;
  if (!config.allowed_emails.includes(data.email)) return null; // removed from the list = signed out
  return data;
}

async function asset(env, request, path) {
  const url = new URL(request.url);
  url.pathname = path;
  url.search = '';
  const res = await env.ASSETS.fetch(new Request(url, { method: request.method, headers: request.headers }));
  return res;
}

async function handleLogin(request, env, url) {
  const state = randomToken();
  const verifier = randomToken(48);
  const oauth = await seal(env.SESSION_SECRET, 'oauth', {
    state, verifier, exp: Math.floor(Date.now() / 1000) + 600,
  });
  const target = buildAuthUrl({
    clientId: env.GOOGLE_CLIENT_ID,
    redirectUri: `${url.origin}/auth/callback`,
    state,
    codeChallenge: await sha256b64url(verifier),
  });
  return redirect(target, [cookie(OAUTH_COOKIE, oauth, 600)]);
}

async function handleCallback(request, env, url, config) {
  const clearOauth = clearCookie(OAUTH_COOKIE);
  const fail = (code) => redirect(`/?error=${encodeURIComponent(code)}`, [clearOauth]);

  const pending = await unseal(env.SESSION_SECRET, 'oauth', readCookie(request, OAUTH_COOKIE));
  if (url.searchParams.get('error')) return fail('denied');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!pending || !code || !state || state !== pending.state) return fail('failed');

  let result;
  try {
    result = await exchangeCode({
      code,
      codeVerifier: pending.verifier,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${url.origin}/auth/callback`,
    });
  } catch (e) {
    return fail(e instanceof SignInError ? e.code : 'failed');
  }
  if (!config.allowed_emails.includes(result.email)) {
    await revoke(result.refreshToken); // don't keep access we won't use
    return fail('not_allowed');
  }
  rememberAccessToken(result.refreshToken, result.accessToken, result.expiresIn);
  const session = await seal(env.SESSION_SECRET, 'session', {
    email: result.email,
    rt: result.refreshToken,
    exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
  });
  return redirect('/', [clearOauth, cookie(SESSION_COOKIE, session, SESSION_DAYS * 86400)]);
}

async function handleLogout(request, env, url, config) {
  // Only accept sign-out from our own page (stops other sites signing you out)
  const origin = request.headers.get('Origin');
  if (origin !== url.origin) return text('Forbidden', 403);
  const session = await currentSession(request, env, config);
  if (session) {
    forgetUser(session.email);
    await revoke(session.rt);
  }
  const res = json({ ok: true });
  res.headers.append('Set-Cookie', clearCookie(SESSION_COOKIE));
  return res;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const isLogout = path === '/logout' && request.method === 'POST';
    if (!isLogout && request.method !== 'GET' && request.method !== 'HEAD') return text('Method not allowed', 405);

    const missing = missingSettings(env);
    const { config, problems } = loadConfig(env.WHATSUP_CONFIG);

    if (path === '/login') {
      if (missing.length) return text(`Sign-in isn't set up yet. Missing in Cloudflare settings: ${missing.join(', ')}.`, 503);
      return handleLogin(request, env, url);
    }
    if (path === '/auth/callback') {
      if (missing.length) return text('Sign-in isn\'t set up yet.', 503);
      return handleCallback(request, env, url, config);
    }
    if (isLogout) return missing.length ? json({ ok: true }) : handleLogout(request, env, url, config);

    if (path === '/api/status') {
      // Public: lets the sign-in page explain what's left to set up (names only).
      const steps = [...missing];
      if (!config.allowed_emails.length) steps.push('allowed_emails in WHATSUP_CONFIG');
      return json({ ready: steps.length === 0, missing: steps });
    }

    const session = missing.length ? null : await currentSession(request, env, config);

    if (path === '/api/settings' || path === '/api/data') {
      if (!session) return json({ signin: true }, 401);
      if (path === '/api/settings') {
        return json(publicSettings(config, FESTIVALS, problems, VERSION, session.email));
      }
      try {
        return json(await getData(env, session));
      } catch (e) {
        if (e instanceof SignInError || e.name === 'CalendarAuthError') {
          forgetUser(session.email);
          return json({ signin: true, reason: 'expired' }, 401, { 'Set-Cookie': clearCookie(SESSION_COOKIE) });
        }
        throw e;
      }
    }
    if (path.startsWith('/api/')) return text('Not found', 404);

    if (path === '/' || path === '/index.html') {
      if (session) {
        return withHeaders(await asset(env, request, '/index.html'), { 'Cache-Control': 'no-store', 'X-Whatsup-Page': 'dashboard' });
      }
      return withHeaders(await asset(env, request, '/signin.html'), { 'Cache-Control': 'no-store', 'X-Whatsup-Page': 'signin' });
    }
    if (path === '/signin.html') return redirect('/');

    return withHeaders(await env.ASSETS.fetch(request));
  },
};
