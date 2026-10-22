// Encrypted, tamper-proof cookies (AES-256-GCM).
//
// The session cookie holds who you are and your Google refresh token. It is
// encrypted with SESSION_SECRET, so the browser can store it but can't read or
// change it, and it's HttpOnly so page scripts can't touch it either.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const SESSION_COOKIE = '__Host-whatsup';
export const OAUTH_COOKIE = '__Host-whatsup-oauth';
export const SESSION_DAYS = 180;

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const keyCache = new Map();

/** SESSION_SECRET must be at least 32 characters (e.g. `openssl rand -base64 32`). */
export function secretOk(secret) {
  return typeof secret === 'string' && secret.trim().length >= 32;
}

async function keyFor(secret, purpose) {
  const id = `${purpose}:${secret}`;
  if (keyCache.has(id)) return keyCache.get(id);
  const base = await crypto.subtle.importKey('raw', enc.encode(secret.trim()), 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('whatsup-v1'), info: enc.encode(purpose) },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
  keyCache.set(id, key);
  return key;
}

/** Encrypts `data` (a JSON-able object). `purpose` binds it to one cookie type. */
export async function seal(secret, purpose, data) {
  const key = await keyFor(secret, purpose);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64url(out);
}

/** Returns the object, or null if missing, tampered with, or expired (`exp` in seconds). */
export async function unseal(secret, purpose, value, nowSec = Math.floor(Date.now() / 1000)) {
  if (!value || value.length > 4000) return null;
  try {
    const raw = fromB64url(value);
    if (raw.length < 13) return null;
    const key = await keyFor(secret, purpose);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12));
    const data = JSON.parse(dec.decode(pt));
    if (!data || typeof data.exp !== 'number' || data.exp < nowSec) return null;
    return data;
  } catch (e) {
    return null;
  }
}

export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function cookie(name, value, maxAgeSec) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function randomToken(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256b64url(text) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
}
