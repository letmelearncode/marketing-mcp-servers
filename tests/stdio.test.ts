import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { config } from './helpers.js';
it('starts all three compiled entrypoints and exchanges MCP over stdio', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-stdio-'));
  const configFile = join(dir, 'projects.json');
  await writeFile(configFile, JSON.stringify(config));
  try {
    for (const mode of ['gsc', 'ga4', 'google']) {
      const client = new Client({ name: 'stdio-integration', version: '1.0.0' });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [resolve(`dist/packages/${mode}-mcp/src/index.js`)],
        env: { PROJECTS_CONFIG: configFile, MCP_TRANSPORT: 'stdio' },
        stderr: 'pipe',
      });
      let stderr = '';
      transport.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });
      try {
        await client.connect(transport);
        expect((await client.listTools()).tools.length).toBe(
          mode === 'gsc' ? 7 : mode === 'ga4' ? 9 : 15,
        );
        expect((await client.callTool({ name: 'projects_list', arguments: {} })).isError).not.toBe(
          true,
        );
        expect(stderr).toBe('');
      } finally {
        await client.close();
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
