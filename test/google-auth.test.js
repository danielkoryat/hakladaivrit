import test from 'node:test';
import assert from 'node:assert';
import { verifyGoogleIdToken, setKeysForTesting } from '../lib/google-auth.js';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const ALG = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
const mine = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
const other = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
setKeysForTesting([{ ...(await crypto.subtle.exportKey('jwk', mine.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }]);

const now = Math.floor(Date.now() / 1000);
const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
async function sign(payload, { kid = 'k1', key = mine.privateKey } = {}) {
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' });
  const body = b64(payload);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${Buffer.from(sig).toString('base64url')}`;
}
const good = {
  iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1234567890', email: 'User@Example.com',
  email_verified: true, name: 'ישראל ישראלי', iat: now, exp: now + 3600,
};

test('accepts a valid token and normalises the email', async () => {
  const u = await verifyGoogleIdToken(await sign(good), CLIENT_ID);
  assert.deepStrictEqual(u, { sub: '1234567890', email: 'user@example.com', name: 'ישראל ישראלי' });
});

test('rejects a token signed with another key', async () => {
  await assert.rejects(verifyGoogleIdToken(await sign(good, { key: other.privateKey }), CLIENT_ID), /bad signature/);
});

test('rejects a tampered payload', async () => {
  const [h, , s] = (await sign(good)).split('.');
  const forged = `${h}.${b64({ ...good, email: 'admin@example.com' })}.${s}`;
  await assert.rejects(verifyGoogleIdToken(forged, CLIENT_ID), /bad signature/);
});

test('rejects a token for another app', async () => {
  await assert.rejects(verifyGoogleIdToken(await sign({ ...good, aud: 'someone-else' }), CLIENT_ID), /wrong audience/);
});

test('rejects a wrong issuer', async () => {
  await assert.rejects(verifyGoogleIdToken(await sign({ ...good, iss: 'evil.example' }), CLIENT_ID), /wrong issuer/);
});

test('rejects an expired token', async () => {
  await assert.rejects(verifyGoogleIdToken(await sign({ ...good, exp: now - 3600 }), CLIENT_ID), /expired/);
});

test('rejects an unverified email', async () => {
  await assert.rejects(verifyGoogleIdToken(await sign({ ...good, email_verified: false }), CLIENT_ID), /not verified/);
});

test('rejects alg=none and garbage', async () => {
  const [, body] = (await sign(good)).split('.');
  await assert.rejects(verifyGoogleIdToken(`${b64({ alg: 'none', kid: 'k1' })}.${body}.`, CLIENT_ID), /unexpected algorithm/);
  await assert.rejects(verifyGoogleIdToken('not-a-token', CLIENT_ID), /malformed/);
});
