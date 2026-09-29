// Verifies "Sign in with Google" ID tokens (JWT, RS256) against Google's published keys.
// Uses Web Crypto, so it runs both in Cloudflare Workers and in Node (for tests).
// https://developers.google.com/identity/gsi/web/guides/verify-google-id-token

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const CLOCK_SKEW = 60; // seconds

let cache = { keys: null, expires: 0 };

export class GoogleAuthError extends Error {}

async function fetchKeys() {
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error(`Google certs request failed: ${res.status}`);
  const { keys } = await res.json();
  const maxAge = Number((/max-age=(\d+)/.exec(res.headers.get('cache-control') || '') || [])[1]) || 3600;
  cache = { keys, expires: Date.now() + maxAge * 1000 };
  return keys;
}

async function keyFor(kid) {
  let keys = cache.keys && Date.now() < cache.expires ? cache.keys : await fetchKeys();
  let jwk = keys.find(k => k.kid === kid);
  // Google rotates keys; refetch once if the token was signed with a key we haven't seen.
  if (!jwk) { keys = await fetchKeys(); jwk = keys.find(k => k.kid === kid); }
  return jwk || null;
}

const b64urlBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const decodeJson = s => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

/**
 * Returns { sub, email, name } for a valid token issued to clientId, or throws GoogleAuthError.
 * `now` (seconds) is injectable for tests.
 */
export async function verifyGoogleIdToken(token, clientId, { now = Date.now() / 1000 } = {}) {
  if (typeof token !== 'string' || token.length > 4096) throw new GoogleAuthError('malformed token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new GoogleAuthError('malformed token');
  let header, payload;
  try { header = decodeJson(parts[0]); payload = decodeJson(parts[1]); } catch { throw new GoogleAuthError('malformed token'); }
  if (header.alg !== 'RS256' || !header.kid) throw new GoogleAuthError('unexpected algorithm');

  const jwk = await keyFor(header.kid);
  if (!jwk) throw new GoogleAuthError('unknown signing key');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  let valid = false;
  try {
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch { valid = false; }
  if (!valid) throw new GoogleAuthError('bad signature');

  if (!ISSUERS.has(payload.iss)) throw new GoogleAuthError('wrong issuer');
  if (payload.aud !== clientId) throw new GoogleAuthError('wrong audience');
  if (typeof payload.exp !== 'number' || payload.exp < now - CLOCK_SKEW) throw new GoogleAuthError('token expired');
  if (typeof payload.iat === 'number' && payload.iat > now + CLOCK_SKEW) throw new GoogleAuthError('token issued in the future');
  if (!payload.sub || !payload.email || payload.email_verified !== true) throw new GoogleAuthError('email not verified');

  return { sub: String(payload.sub), email: String(payload.email).toLowerCase(), name: payload.name ? String(payload.name) : '' };
}

// Test hook: preload the key set instead of fetching it from Google.
export function setKeysForTesting(keys) { cache = { keys, expires: Date.now() + 3600 * 1000 }; }
