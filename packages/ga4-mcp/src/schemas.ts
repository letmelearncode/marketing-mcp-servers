import { z } from 'zod';
import { date } from '../../core/src/tools.js';
const field = z.string().min(1).max(256);
const numeric = z.union([
  z.object({ int64Value: z.string().regex(/^-?\d+$/) }).strict(),
  z.object({ doubleValue: z.number().finite() }).strict(),
]);
const filterLeaf = z.union([
  z
    .object({
      fieldName: field,
      stringFilter: z
        .object({
          matchType: z.enum([
            'EXACT',
            'BEGINS_WITH',
            'ENDS_WITH',
            'CONTAINS',
            'FULL_REGEXP',
            'PARTIAL_REGEXP',
          ]),
          value: z.string().max(4096),
          caseSensitive: z.boolean().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      fieldName: field,
      inListFilter: z
        .object({
          values: z.array(z.string().max(4096)).min(1).max(100),
          caseSensitive: z.boolean().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      fieldName: field,
      numericFilter: z
        .object({
          operation: z.enum([
            'EQUAL',
            'LESS_THAN',
            'LESS_THAN_OR_EQUAL',
            'GREATER_THAN',
            'GREATER_THAN_OR_EQUAL',
          ]),
          value: numeric,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      fieldName: field,
      betweenFilter: z.object({ fromValue: numeric, toValue: numeric }).strict(),
    })
    .strict(),
  z.object({ fieldName: field, emptyFilter: z.object({}).strict() }).strict(),
]);
// Three nesting levels keep the generated MCP JSON schema bounded.
type Leaf = z.infer<typeof filterLeaf>;
export type Filter =
  | { filter: Leaf }
  | { andGroup: { expressions: Filter[] } }
  | { orGroup: { expressions: Filter[] } }
  | { notExpression: Filter };
function filterSchema(depth: number): z.ZodType<Filter> {
  const leaf = z.object({ filter: filterLeaf }).strict();
  if (depth === 0) return leaf;
  const child = filterSchema(depth - 1);
  return z.union([
    leaf,
    z
      .object({ andGroup: z.object({ expressions: z.array(child).min(1).max(20) }).strict() })
      .strict(),
    z
      .object({ orGroup: z.object({ expressions: z.array(child).min(1).max(20) }).strict() })
      .strict(),
    z.object({ notExpression: child }).strict(),
  ]);
}
export const filter = filterSchema(3);
export const orderBy = z.union([
  z
    .object({
      dimension: z
        .object({
          dimensionName: field,
          orderType: z
            .enum(['ALPHANUMERIC', 'CASE_INSENSITIVE_ALPHANUMERIC', 'NUMERIC'])
            .optional(),
        })
        .strict(),
      desc: z.boolean().optional(),
    })
    .strict(),
  z
    .object({ metric: z.object({ metricName: field }).strict(), desc: z.boolean().optional() })
    .strict(),
]);
const gaDate = z.union([date, z.enum(['today', 'yesterday']), z.string().regex(/^\d+daysAgo$/)]);
export const dateRange = z
  .object({ startDate: gaDate, endDate: gaDate, name: z.string().max(64).optional() })
  .strict()
  .refine((v) => {
    function days(s: string) {
      if (s === 'today') return 0;
      if (s === 'yesterday') return 1;
      return /^\d+daysAgo$/.test(s) ? Number.parseInt(s) : null;
    }
    const a = days(v.startDate),
      b = days(v.endDate);
    if (a !== null && b !== null) return a >= b;
    if (a === null && b === null) return v.startDate <= v.endDate;
    return true; // Google resolves mixed relative/absolute dates in the property's timezone.
  }, 'Date range is reversed');
export const commonReport = {
  dimensions: z
    .array(z.object({ name: field }).strict())
    .max(9)
    .optional(),
  metrics: z
    .array(
      z
        .object({
          name: field,
          expression: z.string().max(1024).optional(),
          invisible: z.boolean().optional(),
        })
        .strict(),
    )
    .min(1)
    .max(10),
  dimensionFilter: filter.optional(),
  metricFilter: filter.optional(),
  orderBys: z.array(orderBy).max(20).optional(),
  limit: z.number().int().min(1).max(250000).default(1000),
  metricAggregations: z
    .array(z.enum(['TOTAL', 'MINIMUM', 'MAXIMUM', 'COUNT']))
    .max(4)
    .optional(),
  returnPropertyQuota: z.boolean().default(true),
};
export const reportShape = {
  ...commonReport,
  dateRanges: z.array(dateRange).min(1).max(4),
  offset: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 250000)
    .default(0),
  currencyCode: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  keepEmptyRows: z.boolean().optional(),
};
export const reportSchema = z.object(reportShape).strict();
export const realtimeShape = {
  ...commonReport,
  dimensions: z
    .array(z.object({ name: field }).strict())
    .max(4)
    .optional(),
  metrics: z
    .array(z.object({ name: field }).strict())
    .min(1)
    .max(10),
  minuteRanges: z
    .array(
      z
        .object({
          startMinutesAgo: z.number().int().min(0).max(29),
          endMinutesAgo: z.number().int().min(0).max(29),
          name: z.string().max(64).optional(),
        })
        .strict()
        .refine((v) => v.startMinutesAgo >= v.endMinutesAgo, 'Minute range is reversed'),
    )
    .min(1)
    .max(2)
    .optional(),
};
