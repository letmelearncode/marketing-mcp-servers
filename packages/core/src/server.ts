import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config, Mode } from './config.js';
import type { Api } from './api.js';
import { register } from './tools.js';
import { registerGsc } from '../../gsc-mcp/src/tools.js';
import { registerGa4 } from '../../ga4-mcp/src/tools.js';
export function createServer(config: Config, api: Api, mode: Mode): McpServer {
  const server = new McpServer({ name: `${mode}-google-marketing-mcp`, version: '1.0.0' });
  register(
    server,
    'projects_list',
    'List configured projects available to this server. Credential paths and secrets are never returned.',
    {},
    async () => ({
      projects: Object.entries(config.projects)
        .filter(([, p]) => mode === 'combined' || (mode === 'gsc' ? p.searchConsole : p.analytics))
        .map(([name, p]) => ({
          name,
          googleCloudProjectId: p.googleCloudProjectId,
          discovery: p.discovery,
          ...(mode !== 'ga4' ? { searchConsole: p.searchConsole } : {}),
          ...(mode !== 'gsc' ? { analytics: p.analytics } : {}),
        })),
    }),
  );
  if (mode !== 'ga4') registerGsc(server, config, api);
  if (mode !== 'gsc') registerGa4(server, config, api);
  return server;
}
