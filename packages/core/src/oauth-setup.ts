#!/usr/bin/env node
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { loadConfig, scopesFor, type Mode } from './config.js';
import { oauthClient } from './auth.js';
import { encrypt, encryptionKey, writeSecret } from './secrets.js';

async function main() {
  const [profile = 'default', mode = 'combined'] = process.argv.slice(2);
  if (!['gsc', 'ga4', 'combined'].includes(mode)) throw new Error('Invalid API mode');
  const config = await loadConfig();
  const credential = Object.hasOwn(config.credentials, profile)
    ? config.credentials[profile]
    : undefined;
  if (credential?.type !== 'oauth') throw new Error('Select an OAuth credential profile');
  const key = await encryptionKey();
  const state = randomBytes(32).toString('hex');
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Cannot bind OAuth callback');
  const redirect = `http://127.0.0.1:${address.port}/callback`;
  const client = await oauthClient(credential.clientFile, redirect);
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  try {
    const codePromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Authorization timed out')), 5 * 60_000);
      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', redirect);
        const received = url.searchParams.get('state') ?? '';
        if (
          req.method !== 'GET' ||
          url.pathname !== '/callback' ||
          Buffer.byteLength(received) !== Buffer.byteLength(state) ||
          !timingSafeEqual(Buffer.from(received), Buffer.from(state))
        ) {
          res.writeHead(400).end('Invalid callback');
          return;
        }
        clearTimeout(timeout);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Security-Policy', "default-src 'none'");
        const code = url.searchParams.get('code');
        if (!code || url.searchParams.has('error')) {
          res.end('Authorization declined.');
          reject(new Error('Authorization declined'));
          return;
        }
        res.end('Authorization received. Return to your terminal.');
        resolve(code);
      });
    });
    const scopes = scopesFor(mode as Mode);
    process.stderr.write(
      `Open this Google authorization URL in a browser on this machine:\n${client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: scopes, state, code_challenge: codeChallenge, code_challenge_method: 'S256' as import('google-auth-library').CodeChallengeMethod })}\n`,
    );
    const code = await codePromise;
    const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: redirect });
    if (!tokens.refresh_token) throw new Error('No refresh token returned');
    const granted = tokens.scope?.split(' ') ?? scopes;
    if (!scopes.every((s) => granted.includes(s)))
      throw new Error('Required read-only scopes were not granted');
    await writeSecret(
      credential.tokenFile,
      encrypt({ refresh_token: tokens.refresh_token, scopes: granted }, key),
    );
    process.stderr.write('Encrypted refresh token saved. No tokens were printed.\n');
  } finally {
    server.closeAllConnections();
    server.close();
  }
}
main().catch(() => {
  process.stderr.write(
    'OAuth setup failed. Check credential profile, owner-only file permissions, browser consent and network access.\n',
  );
  process.exit(1);
});
