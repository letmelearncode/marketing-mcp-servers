import { afterEach, describe, expect, it, vi } from 'vitest';
import { connect, textResult } from './helpers.js';
import { reportSchema, filter, realtimeShape } from '../packages/ga4-mcp/src/schemas.js';
import { z } from 'zod';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
async function setup(response: unknown = {}) {
  const request = vi.fn().mockResolvedValue(response);
  const result = await connect({ request });
  cleanups.push(result.close);
  return { ...result, request };
}
const dates = { startDate: '2026-08-01', endDate: '2026-08-31' };
const report = { dateRanges: [dates], metrics: [{ name: 'sessions' }] };
describe('MCP tools through SDK client', () => {
  it('exposes correct independent tool sets with read-only annotations', async () => {
    for (const mode of ['gsc', 'ga4', 'combined'] as const) {
      const { client, close } = await connect({ request: vi.fn() }, mode);
      cleanups.push(close);
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(mode === 'gsc' ? 7 : mode === 'ga4' ? 9 : 15);
      expect(
        tools.every((t) => t.annotations?.readOnlyHint && t.annotations?.destructiveHint === false),
      ).toBe(true);
      expect(JSON.stringify(tools)).not.toContain('refresh_token');
    }
  });
  it('lists project IDs without credential references', async () => {
    const { client } = await setup();
    const text = textResult(await client.callTool({ name: 'projects_list', arguments: {} }));
    expect(text).toContain('alpha');
    expect(text).not.toContain('credential');
  });
  it('routes GSC requests to the configured property and preserves filter/pagination', async () => {
    const { client, request } = await setup({ rows: [{ keys: ['query'] }] });
    const result = await client.callTool({
      name: 'gsc_search_analytics',
      arguments: {
        project: 'beta',
        ...dates,
        rowLimit: 1,
        startRow: 4,
        dimensions: ['query'],
        dimensionFilterGroups: [{ filters: [{ dimension: 'query', expression: 'test' }] }],
      },
    });
    expect(result.isError).not.toBe(true);
    expect(request.mock.calls[0]![0].googleCloudProjectId).toBe('project-beta');
    expect(request.mock.calls[0]![1]).toContain('https%3A%2F%2Fother.example%2F');
    expect(request.mock.calls[0]![3]).toMatchObject({ rowLimit: 1, startRow: 4 });
    expect(JSON.parse(textResult(result)).pagination.nextStartRow).toBe(5);
  });
  it('rejects reversed dates, invalid aggregation, invalid calendar dates and oversized pages', async () => {
    const { client, request } = await setup();
    for (const patch of [
      { startDate: '2026-09-01' },
      { dimensions: ['page'], aggregationType: 'byProperty' },
      { endDate: '2026-02-30' },
      { rowLimit: 25001 },
      { dimensions: ['query', 'query'] },
    ]) {
      expect(
        (
          await client.callTool({
            name: 'gsc_search_analytics',
            arguments: { project: 'alpha', ...dates, ...patch },
          })
        ).isError,
      ).toBe(true);
    }
    expect(request).not.toHaveBeenCalled();
  });
  it('requires explicit discovery permission and rejects unknown project names', async () => {
    const { client, request } = await setup();
    for (const project of ['alpha', '__proto__', 'missing'])
      expect(
        (await client.callTool({ name: 'gsc_sites_list', arguments: { project } })).isError,
      ).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(
      (await client.callTool({ name: 'gsc_sites_list', arguments: { project: 'beta' } })).isError,
    ).not.toBe(true);
  });
  it('rejects inspection URLs outside a configured domain or prefix', async () => {
    const { client, request } = await setup();
    for (const inspectionUrl of [
      'https://example.com.attacker.test/',
      'https://notexample.com/',
      'file:///etc/passwd',
      'https://user:pass@example.com/',
    ])
      expect(
        (
          await client.callTool({
            name: 'gsc_url_inspect',
            arguments: { project: 'alpha', inspectionUrl },
          })
        ).isError,
      ).toBe(true);
    expect(request).not.toHaveBeenCalled();
    await client.callTool({
      name: 'gsc_url_inspect',
      arguments: { project: 'alpha', inspectionUrl: 'https://sub.example.com/a' },
    });
    expect(request.mock.calls[0]![3]).toMatchObject({ siteUrl: 'sc-domain:example.com' });
  });
  it('maps GA4 reports, filters, order and int64 paging to correct property', async () => {
    const { client, request } = await setup({ rows: [{}], rowCount: 10 });
    const dimensionFilter = {
      filter: { fieldName: 'country', stringFilter: { matchType: 'EXACT', value: 'India' } },
    };
    const result = await client.callTool({
      name: 'ga4_run_report',
      arguments: {
        project: 'alpha',
        ...report,
        dimensionFilter,
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        offset: 2,
        limit: 1,
      },
    });
    expect(result.isError).not.toBe(true);
    expect(request.mock.calls[0]![1]).toContain('properties/123:runReport');
    expect(request.mock.calls[0]![3]).toMatchObject({ offset: '2', limit: '1', dimensionFilter });
    expect(JSON.parse(textResult(result)).pagination.nextOffset).toBe(3);
  });
  it('supports batch and realtime without permitting property overrides', async () => {
    const { client, request } = await setup();
    await client.callTool({
      name: 'ga4_batch_reports',
      arguments: { project: 'beta', requests: [report, report] },
    });
    expect(request.mock.calls[0]![1]).toContain('properties/456:batchRunReports');
    expect(request.mock.calls[0]![3].requests).toHaveLength(2);
    const bad = await client.callTool({
      name: 'ga4_batch_reports',
      arguments: { project: 'beta', requests: [{ ...report, property: 'properties/999' }] },
    });
    expect(bad.isError).toBe(true);
    await client.callTool({
      name: 'ga4_realtime',
      arguments: { project: 'alpha', metrics: [{ name: 'activeUsers' }] },
    });
    expect(request.mock.calls.at(-1)![1]).toContain(':runRealtimeReport');
    expect(request.mock.calls.at(-1)![3]).not.toHaveProperty('offset');
  });
  it('never forwards upstream token-bearing errors', async () => {
    const { client, request } = await setup();
    request.mockRejectedValue({
      message: 'refresh_token=SECRET',
      response: { status: 403, data: 'SECRET' },
      config: { headers: { authorization: 'SECRET' } },
    });
    const result = await client.callTool({ name: 'ga4_metadata', arguments: { project: 'alpha' } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(textResult(result)).toContain('denied access');
  });
  it('bounds large responses', async () => {
    const { client } = await setup({ large: 'x'.repeat(4 * 1024 * 1024) });
    expect(
      (await client.callTool({ name: 'ga4_metadata', arguments: { project: 'alpha' } })).isError,
    ).toBe(true);
  });
});
describe('GA4 validation', () => {
  it('enforces filter one-of and nesting bounds', () => {
    const leaf = { filter: { fieldName: 'country', emptyFilter: {} } };
    expect(filter.safeParse({ notExpression: { orGroup: { expressions: [leaf] } } }).success).toBe(
      true,
    );
    expect(
      filter.safeParse({
        filter: { ...leaf.filter, stringFilter: { matchType: 'EXACT', value: 'x' } },
      }).success,
    ).toBe(false);
    expect(filter.safeParse({ filter: leaf.filter, notExpression: leaf }).success).toBe(false);
  });
  it('rejects bad ranges, limits and realtime offsets', () => {
    expect(reportSchema.safeParse({ ...report, limit: 250001 }).success).toBe(false);
    expect(
      reportSchema.safeParse({
        ...report,
        dateRanges: [{ startDate: 'today', endDate: '7daysAgo' }],
      }).success,
    ).toBe(false);
    expect(
      z
        .object(realtimeShape)
        .strict()
        .safeParse({ metrics: [{ name: 'activeUsers' }], offset: 1 }).success,
    ).toBe(false);
  });
});
it('maps the remaining discovery, metadata, sitemap and compatibility endpoints', async () => {
  const { client, request } = await setup({ nextPageToken: 'next' });
  const cases: [string, Record<string, unknown>, string][] = [
    ['gsc_site_get', {}, '/sites/https%3A%2F%2Fother.example%2F'],
    [
      'gsc_sitemaps_list',
      { sitemapIndex: 'https://other.example/index.xml' },
      '/sitemaps?sitemapIndex=https%3A%2F%2Fother.example%2Findex.xml',
    ],
    [
      'gsc_sitemap_get',
      { feedpath: 'https://other.example/sitemap.xml' },
      '/sitemaps/https%3A%2F%2Fother.example%2Fsitemap.xml',
    ],
    [
      'ga4_accounts_list',
      { pageToken: 'opaque token' },
      'accountSummaries?pageSize=50&pageToken=opaque+token',
    ],
    [
      'ga4_properties_list',
      { accountId: '789' },
      'properties?filter=parent%3Aaccounts%2F789&pageSize=50',
    ],
    ['ga4_property_get', {}, '/properties/456'],
    ['ga4_metadata', {}, '/properties/456/metadata'],
    [
      'ga4_check_compatibility',
      { metrics: [{ name: 'sessions' }] },
      '/properties/456:checkCompatibility',
    ],
  ];
  for (const [name, args, suffix] of cases) {
    const result = await client.callTool({ name, arguments: { project: 'beta', ...args } });
    expect(result.isError).not.toBe(true);
    expect(request.mock.calls.at(-1)![1]).toContain(suffix);
  }
});
