import { z } from "zod/v4";

// ── Error codes ────────────────────────────────────────────────────────

export type ChartParseErrorCode =
  | "invalid_json"
  | "invalid_schema"
  | "unsupported_type"
  | "too_many_rows"
  | "too_many_series";

export type ChartParseResult =
  | { ok: true; spec: ChartSpec }
  | { ok: false; code: ChartParseErrorCode; error: string };

// ── Constants ──────────────────────────────────────────────────────────

const SUPPORTED_TYPES = ["bar", "line", "area", "pie"] as const;
const MAX_DATA_ROWS = 50;
const MAX_SERIES = 8;
const DEFAULT_HEIGHT = 240;
const MAX_HEIGHT = 400;

// ── Shared fields ──────────────────────────────────────────────────────

const dataRow = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));

const seriesItem = z.object({
  key: z.string(),
  label: z.string().optional(),
});

const baseFields = {
  version: z.number().optional().default(1),
  kind: z.literal("chart").optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  height: z.number().min(100).max(MAX_HEIGHT).optional().default(DEFAULT_HEIGHT),
};

// ── Cartesian schema (bar, line, area) ─────────────────────────────────

const cartesianSchema = z
  .object({
    ...baseFields,
    type: z.enum(["bar", "line", "area"]),
    data: z.array(dataRow).min(1).max(MAX_DATA_ROWS),
    xKey: z.string(),
    series: z.array(seriesItem).min(1).max(MAX_SERIES),
    stacked: z.boolean().optional().default(false),
  })
  .superRefine((spec, ctx) => {
    for (let i = 0; i < spec.data.length; i++) {
      const row = spec.data[i];
      if (!(spec.xKey in row)) {
        ctx.addIssue({
          code: "custom",
          message: `Row ${i} is missing xKey "${spec.xKey}"`,
          path: ["data", i],
        });
        return;
      }
      for (const s of spec.series) {
        const val = row[s.key];
        if (val === null) continue;
        if (val === undefined || typeof val !== "number" || !Number.isFinite(val)) {
          ctx.addIssue({
            code: "custom",
            message: `Row ${i} has non-numeric value for series key "${s.key}"`,
            path: ["data", i, s.key],
          });
          return;
        }
      }
    }
  });

// ── Pie schema ─────────────────────────────────────────────────────────

const pieSchema = z
  .object({
    ...baseFields,
    type: z.literal("pie"),
    data: z.array(dataRow).min(1).max(MAX_DATA_ROWS),
    nameKey: z.string(),
    valueKey: z.string(),
    donut: z.boolean().optional().default(false),
  })
  .superRefine((spec, ctx) => {
    for (let i = 0; i < spec.data.length; i++) {
      const row = spec.data[i];
      if (!(spec.nameKey in row)) {
        ctx.addIssue({
          code: "custom",
          message: `Row ${i} is missing nameKey "${spec.nameKey}"`,
          path: ["data", i],
        });
        return;
      }
      const val = row[spec.valueKey];
      if (val === undefined || typeof val !== "number" || !Number.isFinite(val)) {
        ctx.addIssue({
          code: "custom",
          message: `Row ${i} has non-numeric value for valueKey "${spec.valueKey}"`,
          path: ["data", i, spec.valueKey],
        });
        return;
      }
    }
  });

// ── Combined schema ────────────────────────────────────────────────────

const chartSpecSchema = z.discriminatedUnion("type", [
  cartesianSchema,
  pieSchema,
]);

export type CartesianChartSpec = z.infer<typeof cartesianSchema>;
export type PieChartSpec = z.infer<typeof pieSchema>;
export type ChartSpec = z.infer<typeof chartSpecSchema>;

// ── Chart colors (indices into CSS variables) ──────────────────────────

export const CHART_COLORS = [
  "hsl(var(--sd-chart-1))",
  "hsl(var(--sd-chart-2))",
  "hsl(var(--sd-chart-3))",
  "hsl(var(--sd-chart-4))",
  "hsl(var(--sd-chart-5))",
] as const;

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

// ── Parser ─────────────────────────────────────────────────────────────

export function tryParseChartSpec(input: string): ChartParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch {
    return { ok: false, code: "invalid_json", error: "Invalid JSON" };
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, code: "invalid_schema", error: "Chart spec must be a JSON object" };
  }

  const obj = raw as Record<string, unknown>;

  // Pre-check for better error code differentiation before Zod runs
  if (typeof obj.type === "string" && !(SUPPORTED_TYPES as readonly string[]).includes(obj.type)) {
    return {
      ok: false,
      code: "unsupported_type",
      error: `Unsupported chart type "${obj.type}". Supported: ${SUPPORTED_TYPES.join(", ")}`,
    };
  }

  if (Array.isArray(obj.data) && obj.data.length > MAX_DATA_ROWS) {
    return {
      ok: false,
      code: "too_many_rows",
      error: `Too many data rows (${obj.data.length}). Maximum: ${MAX_DATA_ROWS}`,
    };
  }

  if (Array.isArray(obj.series) && obj.series.length > MAX_SERIES) {
    return {
      ok: false,
      code: "too_many_series",
      error: `Too many series (${obj.series.length}). Maximum: ${MAX_SERIES}`,
    };
  }

  const result = chartSpecSchema.safeParse(raw);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    return {
      ok: false,
      code: "invalid_schema",
      error: firstIssue?.message ?? "Invalid chart schema",
    };
  }

  return { ok: true, spec: result.data };
}
