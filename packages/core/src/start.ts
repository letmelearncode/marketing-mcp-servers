import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, type Mode } from './config.js';
import { AuthPool } from './auth.js';
import { GoogleApi } from './api.js';
import { createServer } from './server.js';
import { createHttpApp } from './http.js';
import { readSecret } from './secrets.js';

export async function start(mode: Mode) {
  const config = await loadConfig();
  const api = new GoogleApi(new AuthPool(config, mode));
  const transport = process.env.MCP_TRANSPORT ?? 'stdio';
  if (transport === 'stdio') {
    const server = createServer(config, api, mode);
    await server.connect(new StdioServerTransport());
    const shutdown = () => {
      void server.close().finally(() => process.exit(0));
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } else if (transport === 'http') {
    const authMode = process.env.MCP_AUTH_MODE ?? 'bearer';
    if (!['bearer', 'oauth'].includes(authMode))
      throw new Error('Invalid HTTP authentication mode');
    const file = process.env.MCP_AUTH_TOKEN_FILE;
    if (authMode === 'bearer' && !file) throw new Error('MCP_AUTH_TOKEN_FILE is required');
    const token = authMode === 'bearer' ? (await readSecret(file!)).trim() : undefined;
    const oauth =
      authMode === 'oauth'
        ? {
            issuer: process.env.MCP_OAUTH_ISSUER ?? '',
            resource: process.env.MCP_RESOURCE_URL ?? '',
            jwksUrl: process.env.MCP_OAUTH_JWKS_URL ?? '',
            scope: process.env.MCP_OAUTH_SCOPE ?? 'mcp:read',
          }
        : undefined;
    const allowedHosts = (process.env.MCP_ALLOWED_HOSTS ?? 'localhost,127.0.0.1')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const app = createHttpApp(() => createServer(config, api, mode), {
      token,
      oauth,
      allowedHosts,
      allowedOrigins,
    });
    const port = Number(process.env.MCP_PORT ?? '3000');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
    const listener = app.listen(port, process.env.MCP_HOST ?? '127.0.0.1');
    listener.requestTimeout = 65_000;
    listener.headersTimeout = 10_000;
    listener.timeout = 70_000;
    listener.on('error', () => {
      process.stderr.write('HTTP listener failed. Check address and port.\n');
      process.exit(1);
    });
    const shutdown = () => {
      listener.close(() => process.exit(0));
      setTimeout(() => {
        listener.closeAllConnections();
        process.exit(0);
      }, 15_000).unref();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    process.stderr.write('Authenticated Streamable HTTP server starting at /mcp.\n');
  } else throw new Error('MCP_TRANSPORT must be stdio or http');
}
export function run(mode: Mode) {
  start(mode).catch(() => {
    process.stderr.write(
      'Server startup failed. Check configuration, secret permissions and transport settings.\n',
    );
    process.exit(1);
  });
}
