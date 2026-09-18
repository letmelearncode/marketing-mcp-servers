import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, chmod, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encrypt, decrypt, writeSecret, readSecret } from '../packages/core/src/secrets.js';
import { configSchema, loadConfig, scopesFor } from '../packages/core/src/config.js';
import { AuthPool } from '../packages/core/src/auth.js';
import { GoogleApi, safeError } from '../packages/core/src/api.js';
import { config } from './helpers.js';
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), 'google-mcp-test-'));
  directories.push(dir);
  return dir;
}
describe('credentials and configuration', () => {
  it('authenticates encrypted data and rejects tampering or wrong keys', () => {
    const key = Buffer.alloc(32, 1);
    const encrypted = encrypt({ refresh_token: 'secret' }, key);
    expect(encrypted).not.toContain('secret');
    expect(decrypt(encrypted, key)).toEqual({ refresh_token: 'secret' });
    expect(() => decrypt(encrypted, Buffer.alloc(32, 2))).toThrow();
    const tampered = JSON.parse(encrypted);
    tampered.tag = Buffer.alloc(16).toString('base64');
    expect(() => decrypt(JSON.stringify(tampered), key)).toThrow();
  });
  it('writes secrets atomically with private permissions and rejects permissive files', async () => {
    const dir = await temp();
    const file = join(dir, 'tokens', 'google.enc');
    await writeSecret(file, 'first');
    await writeSecret(file, 'second');
    expect(await readSecret(file)).toBe('second');
    if (process.platform !== 'win32') {
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      await chmod(file, 0o644);
      await expect(readSecret(file)).rejects.toThrow('owner-only');
    }
  });
  it('loads OAuth tokens and enforces granted scopes without revealing tokens', async () => {
    const dir = await temp();
    const clientFile = join(dir, 'client.json'),
      tokenFile = join(dir, 'token.enc'),
      keyFile = join(dir, 'key');
    await writeSecret(
      clientFile,
      JSON.stringify({
        installed: { client_id: 'test.apps.googleusercontent.com', client_secret: 'client-secret' },
      }),
    );
    await writeSecret(keyFile, '01'.repeat(32));
    vi.stubEnv('TOKEN_ENCRYPTION_KEY_FILE', keyFile);
    await writeSecret(
      tokenFile,
      encrypt({ refresh_token: 'refresh-secret', scopes: scopesFor('gsc') }, Buffer.alloc(32, 1)),
    );
    const c = {
      ...config,
      credentials: { default: { type: 'oauth' as const, clientFile, tokenFile } },
    };
    const pool = new AuthPool(c, 'gsc');
    const first = await pool.get('default');
    expect(await pool.get('default')).toBe(first);
    await expect(new AuthPool(c, 'combined').get('default')).rejects.toThrow(
      'Google authentication failed',
    );
    expect(await readFile(tokenFile, 'utf8')).not.toContain('refresh-secret');
  });
  it('resolves credential paths relative to YAML and validates references', async () => {
    const dir = await temp();
    const file = join(dir, 'projects.yaml');
    await writeFile(
      file,
      'credentials:\n  default:\n    type: oauth\n    clientFile: client.json\n    tokenFile: token.enc\nprojects:\n  sample:\n    googleCloudProjectId: my-project\n    credential: default\n    analytics:\n      propertyId: "123"\n',
    );
    const parsed = await loadConfig(file);
    expect(parsed.credentials.default).toMatchObject({ clientFile: join(dir, 'client.json') });
    expect(configSchema.safeParse({ ...config, credentials: {} }).success).toBe(false);
    expect(configSchema.safeParse({ ...config, projects: {} }).success).toBe(false);
  });
  it('requests only read-only scopes by service', () => {
    expect(scopesFor('gsc')).toEqual(['https://www.googleapis.com/auth/webmasters.readonly']);
    expect(scopesFor('ga4')).toEqual(['https://www.googleapis.com/auth/analytics.readonly']);
    expect(scopesFor('combined')).toHaveLength(2);
  });
  it('bounds API timeouts/retries, pins endpoints and applies quota project', async () => {
    const request = vi.fn().mockResolvedValue({ data: { ok: true } });
    const pool = new AuthPool(config, 'combined');
    vi.spyOn(pool, 'get').mockResolvedValue({ request } as unknown as Awaited<
      ReturnType<AuthPool['get']>
    >);
    const api = new GoogleApi(pool);
    await expect(api.request(config.projects.alpha!, 'https://evil.example/')).rejects.toThrow(
      'Blocked',
    );
    expect(request).not.toHaveBeenCalled();
    await api.request(
      config.projects.alpha!,
      'https://analyticsdata.googleapis.com/v1beta/properties/123:runReport',
      'POST',
      {},
    );
    expect(request.mock.calls[0]![0]).toMatchObject({
      timeout: 30000,
      maxRedirects: 0,
      retryConfig: { retry: 2, totalTimeout: 60000 },
      headers: { 'x-goog-user-project': 'project-alpha' },
    });
    for (const status of [400, 401, 403, 404, 429, 500])
      expect(safeError({ message: 'SECRET', response: { status, data: 'SECRET' } })).not.toContain(
        'SECRET',
      );
  });
});
it('passes cancellation and a response-size bound to Google requests', async () => {
  const { requestSignal } = await import('../packages/core/src/context.js');
  const controller = new AbortController();
  const request = vi.fn().mockResolvedValue({ data: {} });
  const pool = new AuthPool(config, 'combined');
  vi.spyOn(pool, 'get').mockResolvedValue({ request } as unknown as Awaited<
    ReturnType<AuthPool['get']>
  >);
  const api = new GoogleApi(pool);
  await requestSignal.run(controller.signal, () =>
    api.request(config.projects.alpha!, 'https://www.googleapis.com/webmasters/v3/sites'),
  );
  expect(request.mock.calls[0]![0].maxContentLength).toBe(4 * 1024 * 1024);
  controller.abort();
  expect(request.mock.calls[0]![0].signal.aborted).toBe(true);
  await expect(
    requestSignal.run(controller.signal, () =>
      api.request(config.projects.alpha!, 'https://www.googleapis.com/webmasters/v3/sites'),
    ),
  ).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
});
