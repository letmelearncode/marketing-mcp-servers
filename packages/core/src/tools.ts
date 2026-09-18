import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PublicError } from './config.js';
import { safeError } from './api.js';
import { requestSignal } from './context.js';
export const projectInput = {
  project: z.string().min(1).max(64).describe('Named project from projects_list'),
};
export const pageToken = z.string().max(4096).optional();
export function register<S extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  shape: S,
  handler: (input: z.output<z.ZodObject<S>>) => Promise<unknown>,
) {
  const schema = z.object(shape).strict();
  server.registerTool(
    name,
    {
      description,
      inputSchema: schema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args, extra) => {
      try {
        const result = await requestSignal.run(extra.signal, () => handler(schema.parse(args)));
        const text = JSON.stringify(result);
        if (Buffer.byteLength(text) > 4 * 1024 * 1024)
          throw new PublicError('Response exceeds 4 MiB. Use a smaller page size or fewer fields.');
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: error instanceof PublicError ? error.message : safeError(error),
            },
          ],
        };
      }
    },
  );
}
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s,
    'Invalid calendar date',
  );
export function dateOrder(start: string, end: string) {
  if (start > end) throw new PublicError('startDate must be on or before endDate.');
}
export function discoveryAllowed(allowed: boolean) {
  if (!allowed)
    throw new PublicError(
      'Discovery is disabled for this project. An operator can enable discovery in project configuration.',
    );
}
