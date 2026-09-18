import express, { type ErrorRequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createHash, timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createJwtVerifier, type OAuthResourceOptions } from './remote-auth.js';
export interface HttpOptions {
  token?: string;
  oauth?: OAuthResourceOptions;
  allowedHosts: string[];
  allowedOrigins: string[];
  maxConcurrent?: number;
}
export function createHttpApp(makeServer: () => McpServer, options: HttpOptions) {
  if (
    (!options.oauth && (!options.token || options.token.length < 32)) ||
    (options.oauth && options.token) ||
    !options.allowedHosts.length ||
    options.allowedHosts.includes('*') ||
    options.allowedOrigins.includes('*')
  )
    throw new Error('HTTP requires a strong bearer token and explicit host/origin allowlists.');
  const digest = (s: string) => createHash('sha256').update(s).digest();
  const expected = options.token ? digest(options.token) : undefined;
  const verifyJwt = options.oauth ? createJwtVerifier(options.oauth) : undefined;
  const metadataUrl = options.oauth
    ? `${new URL(options.oauth.resource).origin}/.well-known/oauth-protected-resource/mcp`
    : undefined;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!options.allowedHosts.includes(req.hostname.toLowerCase())) {
      res.status(403).json({ error: 'Host not allowed' });
      return;
    }
    const origin = req.get('origin');
    if (origin && !options.allowedOrigins.includes(origin)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    // No CORS headers: browser embedding requires a deliberately configured gateway.
    next();
  });
  if (options.oauth) {
    const oauth = options.oauth;
    app.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => {
      res.json({
        resource: oauth.resource,
        authorization_servers: [oauth.issuer],
        scopes_supported: [oauth.scope],
        bearer_methods_supported: ['header'],
      });
    });
  }
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use(
    '/mcp',
    rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  app.use('/mcp', async (req, res, next) => {
    const supplied = req.get('authorization') ?? '';
    const bearer = supplied.startsWith('Bearer ') ? supplied.slice(7) : '';
    const authorized =
      bearer.length > 0 &&
      (verifyJwt ? await verifyJwt(bearer) : expected && timingSafeEqual(digest(bearer), expected));
    if (!authorized) {
      res.setHeader(
        'WWW-Authenticate',
        metadataUrl
          ? `Bearer resource_metadata="${metadataUrl}", scope="${options.oauth!.scope}"`
          : 'Bearer realm="mcp"',
      );
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  });
  app.use('/mcp', express.json({ limit: '256kb' }));
  let active = 0;
  app.post('/mcp', async (req, res) => {
    if (active >= (options.maxConcurrent ?? 20)) {
      res.status(503).json({ error: 'Server busy' });
      return;
    }
    active++;
    const server = makeServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    let closed = false;
    const cleanup = () => {
      if (!closed) {
        closed = true;
        active--;
        void server.close().catch(() => undefined);
      }
    };
    res.once('close', cleanup);
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' });
      else res.end();
      cleanup();
    }
  });
  app.all('/mcp', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Stateless endpoint supports POST only' });
  });
  const errors: ErrorRequestHandler = (_error, _req, res, _next) => {
    res.status(400).json({ error: 'Invalid or oversized JSON request' });
  };
  app.use(errors);
  return app;
}
