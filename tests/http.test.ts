import { afterEach, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpApp } from '../packages/core/src/http.js';
import { createServer } from '../packages/core/src/server.js';
import { config } from './helpers.js';
import { request as httpRequest, type Server } from 'node:http';
const token = 'test-only-token-'.repeat(4);
const listeners: Server[] = [];
afterEach(async () => {
  for (const server of listeners.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function setup() {
  const app = createHttpApp(
    () => createServer(config, { request: vi.fn().mockResolvedValue({}) }, 'combined'),
    { token, allowedHosts: ['127.0.0.1'], allowedOrigins: ['https://trusted.example'] },
  );
  const listener = app.listen(0, '127.0.0.1');
  listeners.push(listener);
  await new Promise<void>((resolve, reject) => {
    listener.once('listening', resolve);
    listener.once('error', reject);
  });
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  return `http://127.0.0.1:${address.port}`;
}
it('requires strong token and explicit host/origin allowlists', () => {
  expect(() =>
    createHttpApp(vi.fn(), { token: 'weak', allowedHosts: ['*'], allowedOrigins: [] }),
  ).toThrow();
});
it('blocks missing/wrong auth, hostile hosts/origins, invalid JSON and GET', async () => {
  const url = await setup();
  expect((await fetch(`${url}/healthz`)).status).toBe(200);
  expect((await fetch(`${url}/mcp`, { method: 'POST' })).status).toBe(401);
  expect(
    (await fetch(`${url}/mcp`, { method: 'POST', headers: { Authorization: 'Bearer wrong' } }))
      .status,
  ).toBe(401);
  expect(
    (
      await fetch(`${url}/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Origin: 'https://evil.example' },
      })
    ).status,
  ).toBe(403);
  const badHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(
      `${url}/mcp`,
      { method: 'POST', headers: { Host: 'evil.example' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', reject);
    req.end();
  });
  expect(badHostStatus).toBe(403);
  expect(
    (await fetch(`${url}/mcp`, { headers: { Authorization: `Bearer ${token}` } })).status,
  ).toBe(405);
  expect(
    (
      await fetch(`${url}/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await fetch(`${url}/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'x'.repeat(300000) }),
      })
    ).status,
  ).toBe(400);
});
it('completes real Streamable HTTP initialize, tools/list and tools/call roundtrip', async () => {
  const url = await setup();
  const client = new Client({ name: 'http-integration', version: '1.0.0' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    expect((await client.listTools()).tools).toHaveLength(15);
    const result = await client.callTool({ name: 'projects_list', arguments: {} });
    expect(JSON.stringify(result)).toContain('alpha');
  } finally {
    await client.close();
  }
});
it('publishes OAuth resource metadata and challenges without a static-token fallback', async () => {
  const app = createHttpApp(() => createServer(config, { request: vi.fn() }, 'combined'), {
    allowedHosts: ['127.0.0.1'],
    allowedOrigins: [],
    oauth: {
      issuer: 'https://login.example/',
      resource: 'https://mcp.example/mcp',
      jwksUrl: 'https://login.example/jwks',
      scope: 'mcp:read',
    },
  });
  const listener = app.listen(0, '127.0.0.1');
  listeners.push(listener);
  await new Promise<void>((resolve, reject) => {
    listener.once('listening', resolve);
    listener.once('error', reject);
  });
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const base = `http://127.0.0.1:${address.port}`;
  const metadata = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
  expect(await metadata.json()).toMatchObject({
    resource: 'https://mcp.example/mcp',
    authorization_servers: ['https://login.example/'],
    scopes_supported: ['mcp:read'],
  });
  const challenge = await fetch(`${base}/mcp`, { method: 'POST' });
  expect(challenge.status).toBe(401);
  expect(challenge.headers.get('WWW-Authenticate')).toContain(
    'https://mcp.example/.well-known/oauth-protected-resource/mcp',
  );
});
