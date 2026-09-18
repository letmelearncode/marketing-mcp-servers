import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const name = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const site = z
  .string()
  .max(2048)
  .refine((v) => {
    if (/^sc-domain:[a-zA-Z0-9.-]+$/.test(v)) return true;
    try {
      const u = new URL(v);
      return (
        ['https:', 'http:'].includes(u.protocol) &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash
      );
    } catch {
      return false;
    }
  }, 'Expected a Search Console domain or URL-prefix property');
const credential = z.discriminatedUnion('type', [
  z.object({ type: z.literal('adc') }).strict(),
  z.object({ type: z.literal('service_account'), keyFile: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal('oauth'),
      clientFile: z.string().min(1),
      tokenFile: z.string().min(1),
    })
    .strict(),
]);
export const configSchema = z
  .object({
    credentials: z.record(name, credential),
    projects: z.record(
      name,
      z
        .object({
          googleCloudProjectId: z.string().regex(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/),
          credential: name,
          discovery: z.boolean().default(false),
          searchConsole: z.object({ siteUrl: site }).strict().optional(),
          analytics: z
            .object({ propertyId: z.string().regex(/^[1-9][0-9]*$/) })
            .strict()
            .optional(),
        })
        .strict()
        .refine((p) => p.searchConsole || p.analytics, 'At least one API must be configured'),
    ),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (!Object.keys(c.projects).length)
      ctx.addIssue({ code: 'custom', message: 'No projects configured' });
    for (const [key, project] of Object.entries(c.projects)) {
      if (!Object.hasOwn(c.credentials, project.credential))
        ctx.addIssue({
          code: 'custom',
          path: ['projects', key, 'credential'],
          message: 'Unknown credential profile',
        });
    }
  });
export type Config = z.infer<typeof configSchema>;
export type Project = Config['projects'][string];
export type Mode = 'gsc' | 'ga4' | 'combined';
export const SCOPES = {
  gsc: 'https://www.googleapis.com/auth/webmasters.readonly',
  ga4: 'https://www.googleapis.com/auth/analytics.readonly',
};
export function scopesFor(mode: Mode): string[] {
  return mode === 'combined' ? Object.values(SCOPES) : [SCOPES[mode]];
}
export async function loadConfig(
  file = process.env.PROJECTS_CONFIG ?? './config/projects.yaml',
): Promise<Config> {
  let c: Config;
  try {
    c = configSchema.parse(parse(await readFile(file, 'utf8'), { maxAliasCount: 20 }));
  } catch {
    throw new Error(
      'Invalid project configuration; check YAML, project IDs and credential references.',
    );
  }
  for (const profile of Object.values(c.credentials)) {
    if (profile.type === 'oauth') {
      profile.clientFile = resolve(dirname(file), profile.clientFile);
      profile.tokenFile = resolve(dirname(file), profile.tokenFile);
    }
    if (profile.type === 'service_account')
      profile.keyFile = resolve(dirname(file), profile.keyFile);
  }
  return c;
}
export function projectFor(config: Config, name: string, api?: 'gsc' | 'ga4'): Project {
  const p = Object.hasOwn(config.projects, name) ? config.projects[name] : undefined;
  if (!p) throw new PublicError('Unknown project. Use projects_list.');
  if ((api === 'gsc' && !p.searchConsole) || (api === 'ga4' && !p.analytics))
    throw new PublicError('This API is not configured for the selected project.');
  return p;
}
export class PublicError extends Error {}
