import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { configSchema, type Mode } from '../packages/core/src/config.js';
import { createServer } from '../packages/core/src/server.js';
import type { Api } from '../packages/core/src/api.js';
export const config = configSchema.parse({
  credentials: { default: { type: 'adc' } },
  projects: {
    alpha: {
      googleCloudProjectId: 'project-alpha',
      credential: 'default',
      searchConsole: { siteUrl: 'sc-domain:example.com' },
      analytics: { propertyId: '123' },
    },
    beta: {
      googleCloudProjectId: 'project-beta',
      credential: 'default',
      discovery: true,
      searchConsole: { siteUrl: 'https://other.example/' },
      analytics: { propertyId: '456' },
    },
  },
});
export async function connect(api: Api, mode: Mode = 'combined') {
  const server = createServer(config, api, mode);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
export function textResult(result: unknown): string {
  return (result as { content: { text: string }[] }).content[0]!.text;
}
