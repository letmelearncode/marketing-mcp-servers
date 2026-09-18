import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { type Config, projectFor, PublicError } from '../../core/src/config.js';
import type { Api } from '../../core/src/api.js';
import { register, projectInput, date, dateOrder, discoveryAllowed } from '../../core/src/tools.js';
const base = 'https://www.googleapis.com/webmasters/v3';
const filterDimension = z.enum(['country', 'device', 'page', 'query', 'searchAppearance']);
export const searchShape = {
  ...projectInput,
  startDate: date,
  endDate: date,
  dimensions: z
    .array(z.enum(['country', 'device', 'page', 'query', 'searchAppearance', 'date', 'hour']))
    .max(7)
    .refine((a) => new Set(a).size === a.length, 'Duplicate dimensions')
    .optional(),
  type: z.enum(['web', 'image', 'video', 'news', 'discover', 'googleNews']).default('web'),
  dimensionFilterGroups: z
    .array(
      z
        .object({
          groupType: z.literal('and').default('and'),
          filters: z
            .array(
              z
                .object({
                  dimension: filterDimension,
                  operator: z
                    .enum([
                      'equals',
                      'notEquals',
                      'contains',
                      'notContains',
                      'includingRegex',
                      'excludingRegex',
                    ])
                    .default('equals'),
                  expression: z.string().max(4096),
                })
                .strict(),
            )
            .min(1)
            .max(50),
        })
        .strict(),
    )
    .max(10)
    .optional(),
  aggregationType: z.enum(['auto', 'byPage', 'byProperty', 'byNewsShowcasePanel']).default('auto'),
  dataState: z.enum(['final', 'all', 'hourly_all']).default('final'),
  rowLimit: z.number().int().min(1).max(25000).default(1000),
  startRow: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 25000)
    .default(0),
};
export function registerGsc(server: McpServer, config: Config, api: Api) {
  register(
    server,
    'gsc_sites_list',
    'Discover all Search Console properties visible to the configured identity. Requires discovery=true.',
    projectInput,
    async ({ project }) => {
      const p = projectFor(config, project, 'gsc');
      discoveryAllowed(p.discovery);
      return api.request(p, `${base}/sites`);
    },
  );
  register(
    server,
    'gsc_site_get',
    'Get permission details for the configured Search Console property.',
    projectInput,
    async ({ project }) => {
      const p = projectFor(config, project, 'gsc');
      return api.request(p, `${base}/sites/${encodeURIComponent(p.searchConsole!.siteUrl)}`);
    },
  );
  register(
    server,
    'gsc_search_analytics',
    'Query Search Analytics. Explicit pagination via startRow/rowLimit; top rows only, not a complete export. Dates use Pacific time. Fresh/hourly data can be incomplete.',
    searchShape,
    async ({ project, ...body }) => {
      const p = projectFor(config, project, 'gsc');
      dateOrder(body.startDate, body.endDate);
      const page =
        body.dimensions?.includes('page') ||
        body.dimensionFilterGroups?.some((g) => g.filters.some((f) => f.dimension === 'page'));
      if (
        body.aggregationType === 'byProperty' &&
        (page || ['discover', 'googleNews'].includes(body.type))
      )
        throw new PublicError(
          'byProperty cannot be used with page grouping/filtering, discover or googleNews.',
        );
      if (body.dimensions?.includes('hour') && body.dataState !== 'hourly_all')
        throw new PublicError('hour requires dataState=hourly_all.');
      const data = await api.request(
        p,
        `${base}/sites/${encodeURIComponent(p.searchConsole!.siteUrl)}/searchAnalytics/query`,
        'POST',
        body,
      );
      const rows = (data as { rows?: unknown[] }).rows ?? [];
      return {
        data,
        pagination: {
          nextStartRow: rows.length === body.rowLimit ? body.startRow + rows.length : null,
        },
        note: 'Search Console returns top rows and may omit anonymized queries. Pagination does not guarantee a complete export.',
      };
    },
  );
  register(
    server,
    'gsc_sitemaps_list',
    'List submitted sitemaps, optionally under a sitemap index.',
    { ...projectInput, sitemapIndex: z.string().url().max(2048).optional() },
    async ({ project, sitemapIndex }) => {
      const p = projectFor(config, project, 'gsc');
      const query = sitemapIndex ? `?sitemapIndex=${encodeURIComponent(sitemapIndex)}` : '';
      return api.request(
        p,
        `${base}/sites/${encodeURIComponent(p.searchConsole!.siteUrl)}/sitemaps${query}`,
      );
    },
  );
  register(
    server,
    'gsc_sitemap_get',
    'Read one submitted sitemap. Does not submit or delete sitemaps.',
    { ...projectInput, feedpath: z.string().url().max(2048) },
    async ({ project, feedpath }) => {
      const p = projectFor(config, project, 'gsc');
      return api.request(
        p,
        `${base}/sites/${encodeURIComponent(p.searchConsole!.siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`,
      );
    },
  );
  register(
    server,
    'gsc_url_inspect',
    'Inspect the indexed version of a URL in the configured property; not a live test or indexing request.',
    {
      ...projectInput,
      inspectionUrl: z.string().url().max(2048),
      languageCode: z.string().max(35).default('en-US'),
    },
    async ({ project, inspectionUrl, languageCode }) => {
      const p = projectFor(config, project, 'gsc');
      const siteUrl = p.searchConsole!.siteUrl;
      const url = new URL(inspectionUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new PublicError('Inspection requires an HTTP(S) URL without credentials.');
      if (siteUrl.startsWith('sc-domain:')) {
        const domain = siteUrl.slice(10).toLowerCase();
        if (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`))
          throw new PublicError('URL is outside the configured property.');
      } else if (!url.href.startsWith(new URL(siteUrl).href))
        throw new PublicError('URL is outside the configured property.');
      return api.request(
        p,
        'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
        'POST',
        { inspectionUrl, siteUrl, languageCode },
      );
    },
  );
}
