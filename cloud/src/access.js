// Verifies the Cloudflare Access token on every request.
//
// Cloudflare Access sits in front of the Worker and only lets approved
// people through. As a second lock, the Worker itself checks the signed
// token Access attaches (Cf-Access-Jwt-Assertion). If Access is ever
// switched off by mistake, or the settings below are missing, the Worker
// refuses to serve anything ("fail closed").

const enc = new TextEncoder();
let jwksCache = { teamDomain: null, keys: null, fetchedAt: 0 };
const JWKS_TTL_MS = 60 * 60 * 1000;

function b64urlToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

export function normaliseTeamDomain(value) {
  let v = String(value || '').trim().toLowerCase();
  v = v.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (v && !v.includes('.')) v = `${v}.cloudflareaccess.com`;
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(v)) return null;
  return `https://${v}`;
}

async function getKeys(teamDomain, fetchImpl, force = false) {
  const now = Date.now();
  if (!force && jwksCache.teamDomain === teamDomain && jwksCache.keys && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetchImpl(`${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`certs HTTP ${res.status}`);
  const body = await res.json();
  const keys = {};
  for (const jwk of body.keys || []) {
    if (jwk.kty !== 'RSA' || !jwk.kid) continue;
    keys[jwk.kid] = await crypto.subtle.importKey(
      'jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
    );
  }
  jwksCache = { teamDomain, keys, fetchedAt: now };
  return keys;
}

/**
 * Returns { ok: true, email } or { ok: false, status, reason }.
 */
export async function verifyAccess(request, env, fetchImpl = fetch, nowSec = () => Math.floor(Date.now() / 1000)) {
  const teamDomain = normaliseTeamDomain(env.TEAM_DOMAIN);
  const aud = String(env.POLICY_AUD || '').trim();
  if (!teamDomain || !aud) {
    return { ok: false, status: 503, reason: 'not-configured' };
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return { ok: false, status: 403, reason: 'no-token' };

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, status: 403, reason: 'malformed' };
  let header;
  let payload;
  try {
    header = b64urlJson(parts[0]);
    payload = b64urlJson(parts[1]);
  } catch (e) {
    return { ok: false, status: 403, reason: 'malformed' };
  }
  if (header.alg !== 'RS256' || !header.kid) return { ok: false, status: 403, reason: 'bad-alg' };

  let keys;
  try {
    keys = await getKeys(teamDomain, fetchImpl);
    if (!keys[header.kid]) keys = await getKeys(teamDomain, fetchImpl, true); // key rotation
  } catch (e) {
    return { ok: false, status: 503, reason: 'certs-unavailable' };
  }
  const key = keys[header.kid];
  if (!key) return { ok: false, status: 403, reason: 'unknown-key' };

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) return { ok: false, status: 403, reason: 'bad-signature' };

  const now = nowSec();
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return { ok: false, status: 403, reason: 'wrong-audience' };
  if (payload.iss !== teamDomain) return { ok: false, status: 403, reason: 'wrong-issuer' };
  if (typeof payload.exp !== 'number' || payload.exp < now - 30) return { ok: false, status: 403, reason: 'expired' };
  if (typeof payload.nbf === 'number' && payload.nbf > now + 30) return { ok: false, status: 403, reason: 'not-yet-valid' };

  return { ok: true, email: payload.email || null };
}

// for tests
export function _resetAccessCache() {
  jwksCache = { teamDomain: null, keys: null, fetchedAt: 0 };
}
