// Whatsup family dashboard — Cloudflare Worker.
//
// Serves the same page as the local Mac version (../static) plus two JSON
// endpoints. Every request, including the page itself, must carry a valid
// Cloudflare Access token; otherwise nothing is served.

import { verifyAccess } from './access.js';
import { loadConfig, publicSettings } from './config.js';
import { getData, VERSION } from './data.js';
import festivalsFile from '../../config/festivals.json' with { type: 'json' };

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
  "connect-src 'self'", "font-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'",
  "frame-ancestors 'none'", 'frame-src https://www.youtube-nocookie.com https://www.youtube.com',
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Robots-Tag': 'noindex, nofollow',
  'Strict-Transport-Security': 'max-age=31536000',
};

const FESTIVALS = (festivalsFile.festivals || [])
  .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(String(f.date)) && f.name)
  .map((f) => ({ date: f.date, name: String(f.name).slice(0, 40) }));

function withHeaders(response, extra = {}) {
  const res = new Response(response.body, response);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) res.headers.set(k, v);
  return res;
}

function json(obj, status = 200) {
  return withHeaders(new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  }));
}

function text(body, status) {
  return withHeaders(new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  }));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return text('Method not allowed', 405);

    const auth = await verifyAccess(request, env);
    if (!auth.ok) {
      if (auth.reason === 'not-configured') {
        return text('This dashboard is locked until Cloudflare Access is set up (README: "Put it online", step 5).', 503);
      }
      return text('Not authorised. Open this page through Cloudflare Access sign-in.', auth.status);
    }

    if (url.pathname === '/api/settings') {
      const { config, problems } = loadConfig(env.WHATSUP_CONFIG);
      if (config.calendars.length && !env.GOOGLE_SERVICE_ACCOUNT) problems.push('GOOGLE_SERVICE_ACCOUNT secret is not set yet');
      return json(publicSettings(config, FESTIVALS, problems, VERSION));
    }
    if (url.pathname === '/api/data') {
      return json(await getData(env));
    }
    if (url.pathname.startsWith('/api/')) return text('Not found', 404);

    const asset = await env.ASSETS.fetch(request);
    return withHeaders(asset);
  },
};
