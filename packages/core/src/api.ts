import { PublicError, type Project } from './config.js';
import { requestSignal } from './context.js';
import type { AuthPool } from './auth.js';
export interface Api {
  request(project: Project, url: string, method?: 'GET' | 'POST', body?: unknown): Promise<unknown>;
}
const hosts = new Set([
  'www.googleapis.com',
  'searchconsole.googleapis.com',
  'analyticsdata.googleapis.com',
  'analyticsadmin.googleapis.com',
]);
export class GoogleApi implements Api {
  private active = 0;
  constructor(private auth: AuthPool) {}
  async request(
    project: Project,
    url: string,
    method: 'GET' | 'POST' = 'GET',
    body?: unknown,
  ): Promise<unknown> {
    const target = new URL(url);
    if (
      target.protocol !== 'https:' ||
      !hosts.has(target.hostname) ||
      target.username ||
      target.password ||
      target.port
    )
      throw new Error('Blocked API endpoint');
    if (this.active >= 20)
      throw new PublicError('Google request concurrency limit reached. Retry later.');
    this.active++;
    try {
      const signal = AbortSignal.any([
        AbortSignal.timeout(60_000),
        ...(requestSignal.getStore() ? [requestSignal.getStore()!] : []),
      ]);
      signal.throwIfAborted();
      const client = await this.auth.get(project.credential);
      signal.throwIfAborted();
      const response = await client.request({
        url,
        method,
        data: body,
        timeout: 30_000,
        signal,
        maxContentLength: 4 * 1024 * 1024,
        maxRedirects: 0,
        responseType: 'json',
        headers: { 'x-goog-user-project': project.googleCloudProjectId },
        retry: true,
        retryConfig: {
          retry: 2,
          httpMethodsToRetry: ['GET', 'POST'],
          statusCodesToRetry: [
            [429, 429],
            [500, 599],
          ],
          totalTimeout: 60_000,
        },
      });
      return response.data;
    } finally {
      this.active--;
    }
  }
}
export function safeError(error: unknown): string {
  // Never forward Google/Gaxios messages: they can contain headers, tokens or URLs.
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 400)
    return 'Google rejected this request. Check fields, filters, date ranges and metric/dimension compatibility.';
  if (status === 401)
    return 'Google authorization expired or was revoked. Reauthorize the server credential.';
  if (status === 403)
    return 'Google denied access. Check API enablement, property access, read-only scopes and quota-project IAM.';
  if (status === 404) return 'Google resource not found or not accessible.';
  if (status === 429) return 'Google quota exhausted. Retry later with fewer or smaller reports.';
  return 'Google request or server operation failed. Check server configuration and retry later.';
}
