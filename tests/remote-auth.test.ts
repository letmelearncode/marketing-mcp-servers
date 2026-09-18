import { expect, it } from 'vitest';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { createJwtVerifier, validateOAuthOptions } from '../packages/core/src/remote-auth.js';
const options = {
  issuer: 'https://login.example.com/',
  resource: 'https://mcp.example.com/mcp',
  jwksUrl: 'https://login.example.com/jwks',
  scope: 'mcp:read',
};
it('validates issuer, audience, expiry, signature and required scope', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test';
  const verify = createJwtVerifier(options, createLocalJWKSet({ keys: [jwk] }));
  async function sign(patch: Record<string, unknown> = {}) {
    return new SignJWT({
      iss: options.issuer,
      aud: options.resource,
      sub: 'operator',
      scope: 'mcp:read',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      ...patch,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .sign(privateKey);
  }
  expect(await verify(await sign())).toBe(true);
  for (const patch of [
    { iss: 'https://evil.example/' },
    { aud: 'https://other.example/mcp' },
    { exp: 1 },
    { scope: 'admin' },
    { sub: undefined },
  ])
    expect(await verify(await sign(patch))).toBe(false);
  expect(await verify('not-a-jwt')).toBe(false);
});
it('rejects non-HTTPS and malformed OAuth endpoints', () => {
  expect(() => validateOAuthOptions({ ...options, jwksUrl: 'http://localhost/jwks' })).toThrow();
  expect(() =>
    validateOAuthOptions({ ...options, resource: 'https://mcp.example.com/other' }),
  ).toThrow();
  expect(() => validateOAuthOptions({ ...options, scope: 'invalid scope' })).toThrow();
});
