import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { type Config, projectFor } from '../../core/src/config.js';
import type { Api } from '../../core/src/api.js';
import { register, projectInput, pageToken, discoveryAllowed } from '../../core/src/tools.js';
import { reportShape, reportSchema, realtimeShape, filter } from './schemas.js';
const dataBase = 'https://analyticsdata.googleapis.com/v1beta';
const adminBase = 'https://analyticsadmin.googleapis.com/v1beta';
export function registerGa4(server: McpServer, config: Config, api: Api) {
  register(
    server,
    'ga4_accounts_list',
    'Discover Analytics account/property summaries visible to the identity. Requires discovery=true. Continue with nextPageToken.',
    { ...projectInput, pageSize: z.number().int().min(1).max(200).default(50), pageToken },
    async ({ project, pageSize, pageToken }) => {
      const p = projectFor(config, project, 'ga4');
      discoveryAllowed(p.discovery);
      const query = new URLSearchParams({
        pageSize: String(pageSize),
        ...(pageToken ? { pageToken } : {}),
      });
      return api.request(p, `${adminBase}/accountSummaries?${query}`);
    },
  );
  register(
    server,
    'ga4_properties_list',
    'Discover properties in an account. Requires discovery=true.',
    {
      ...projectInput,
      accountId: z.string().regex(/^[1-9][0-9]*$/),
      pageSize: z.number().int().min(1).max(200).default(50),
      pageToken,
    },
    async ({ project, accountId, pageSize, pageToken }) => {
      const p = projectFor(config, project, 'ga4');
      discoveryAllowed(p.discovery);
      const query = new URLSearchParams({
        filter: `parent:accounts/${accountId}`,
        pageSize: String(pageSize),
        ...(pageToken ? { pageToken } : {}),
      });
      return api.request(p, `${adminBase}/properties?${query}`);
    },
  );
  register(
    server,
    'ga4_property_get',
    'Read configured property details, including timezone and currency.',
    projectInput,
    async ({ project }) => {
      const p = projectFor(config, project, 'ga4');
      return api.request(p, `${adminBase}/properties/${p.analytics!.propertyId}`);
    },
  );
  register(
    server,
    'ga4_metadata',
    'List available core report dimensions and metrics, including property-specific custom definitions. Realtime has a separate Google schema.',
    projectInput,
    async ({ project }) => {
      const p = projectFor(config, project, 'ga4');
      return api.request(p, `${dataBase}/properties/${p.analytics!.propertyId}/metadata`);
    },
  );
  register(
    server,
    'ga4_check_compatibility',
    'Check whether core report dimensions, metrics and filters work together.',
    {
      ...projectInput,
      dimensions: reportShape.dimensions,
      metrics: reportShape.metrics,
      dimensionFilter: filter.optional(),
      metricFilter: filter.optional(),
    },
    async ({ project, ...body }) => {
      const p = projectFor(config, project, 'ga4');
      return api.request(
        p,
        `${dataBase}/properties/${p.analytics!.propertyId}:checkCompatibility`,
        'POST',
        body,
      );
    },
  );
  register(
    server,
    'ga4_run_report',
    'Run a GA4 core report. Page with offset/limit; use metadata for names and compatibility tool for valid combinations. Dates use property timezone.',
    { ...projectInput, ...reportShape },
    async ({ project, ...body }) => {
      const p = projectFor(config, project, 'ga4');
      const data = await api.request(
        p,
        `${dataBase}/properties/${p.analytics!.propertyId}:runReport`,
        'POST',
        { ...body, offset: String(body.offset), limit: String(body.limit) },
      );
      const result = data as { rows?: unknown[]; rowCount?: number };
      const next = body.offset + (result.rows?.length ?? 0);
      return {
        data,
        pagination: {
          nextOffset: next > body.offset && next < (result.rowCount ?? 0) ? next : null,
        },
      };
    },
  );
  register(
    server,
    'ga4_batch_reports',
    'Run 1–5 core reports for the same configured property. Each report has its own offset/limit and rowCount.',
    { ...projectInput, requests: z.array(reportSchema).min(1).max(5) },
    async ({ project, requests }) => {
      const p = projectFor(config, project, 'ga4');
      return api.request(
        p,
        `${dataBase}/properties/${p.analytics!.propertyId}:batchRunReports`,
        'POST',
        {
          requests: requests.map((body) => ({
            ...body,
            offset: String(body.offset),
            limit: String(body.limit),
          })),
        },
      );
    },
  );
  register(
    server,
    'ga4_realtime',
    'Run a realtime report for the last 30 minutes. Realtime uses different dimensions/metrics and does not support offset pagination.',
    { ...projectInput, ...realtimeShape },
    async ({ project, ...body }) => {
      const p = projectFor(config, project, 'ga4');
      return api.request(
        p,
        `${dataBase}/properties/${p.analytics!.propertyId}:runRealtimeReport`,
        'POST',
        { ...body, limit: String(body.limit) },
      );
    },
  );
}
