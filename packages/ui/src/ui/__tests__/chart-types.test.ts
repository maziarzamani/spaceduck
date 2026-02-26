import { describe, test, expect } from "bun:test";
import { tryParseChartSpec } from "../chart-types";
import type { ChartParseErrorCode } from "../chart-types";

function validBar(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "bar",
    data: [
      { month: "Jan", revenue: 4000 },
      { month: "Feb", revenue: 3000 },
    ],
    xKey: "month",
    series: [{ key: "revenue", label: "Revenue" }],
    ...overrides,
  });
}

function validPie(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "pie",
    data: [
      { source: "Organic", value: 42 },
      { source: "Direct", value: 31 },
    ],
    nameKey: "source",
    valueKey: "value",
    ...overrides,
  });
}

function expectError(input: string, code: ChartParseErrorCode) {
  const result = tryParseChartSpec(input);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe(code);
  }
}

describe("tryParseChartSpec", () => {
  describe("valid specs", () => {
    test("bar chart with defaults applied", () => {
      const result = tryParseChartSpec(validBar());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.spec.type).toBe("bar");
        expect(result.spec.version).toBe(1);
        expect(result.spec.height).toBe(240);
        if (result.spec.type !== "pie") {
          expect(result.spec.stacked).toBe(false);
        }
      }
    });

    test("line chart", () => {
      const result = tryParseChartSpec(validBar({ type: "line" }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.spec.type).toBe("line");
    });

    test("area chart", () => {
      const result = tryParseChartSpec(validBar({ type: "area" }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.spec.type).toBe("area");
    });

    test("pie chart", () => {
      const result = tryParseChartSpec(validPie());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.spec.type).toBe("pie");
        if (result.spec.type === "pie") {
          expect(result.spec.donut).toBe(false);
        }
      }
    });

    test("pie chart with donut", () => {
      const result = tryParseChartSpec(validPie({ donut: true }));
      expect(result.ok).toBe(true);
      if (result.ok && result.spec.type === "pie") {
        expect(result.spec.donut).toBe(true);
      }
    });

    test("version field defaults to 1 when omitted", () => {
      const result = tryParseChartSpec(validBar());
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.spec.version).toBe(1);
    });

    test("explicit version preserved", () => {
      const result = tryParseChartSpec(validBar({ version: 2 }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.spec.version).toBe(2);
    });

    test("optional kind field accepted", () => {
      const result = tryParseChartSpec(validBar({ kind: "chart" }));
      expect(result.ok).toBe(true);
    });

    test("custom height within range", () => {
      const result = tryParseChartSpec(validBar({ height: 300 }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.spec.height).toBe(300);
    });

    test("stacked bar chart", () => {
      const result = tryParseChartSpec(
        JSON.stringify({
          type: "bar",
          data: [{ month: "Jan", a: 10, b: 20 }],
          xKey: "month",
          series: [{ key: "a" }, { key: "b" }],
          stacked: true,
        }),
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.spec.type !== "pie") {
        expect(result.spec.stacked).toBe(true);
      }
    });

    test("title and description preserved", () => {
      const result = tryParseChartSpec(
        validBar({ title: "My Chart", description: "Some details" }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.spec.title).toBe("My Chart");
        expect(result.spec.description).toBe("Some details");
      }
    });
  });

  describe("invalid_json", () => {
    test("malformed JSON", () => {
      expectError("{nope}", "invalid_json");
    });

    test("empty string", () => {
      expectError("", "invalid_json");
    });

    test("plain text", () => {
      expectError("not json at all", "invalid_json");
    });
  });

  describe("unsupported_type", () => {
    test("radar type", () => {
      expectError(
        JSON.stringify({ type: "radar", data: [{ a: 1 }] }),
        "unsupported_type",
      );
    });

    test("scatter type", () => {
      expectError(
        JSON.stringify({ type: "scatter", data: [] }),
        "unsupported_type",
      );
    });

    test("heatmap type", () => {
      expectError(
        JSON.stringify({ type: "heatmap", data: [] }),
        "unsupported_type",
      );
    });
  });

  describe("too_many_rows", () => {
    test("51 data rows rejected", () => {
      const data = Array.from({ length: 51 }, (_, i) => ({
        x: `item-${i}`,
        y: i,
      }));
      expectError(
        JSON.stringify({
          type: "bar",
          data,
          xKey: "x",
          series: [{ key: "y" }],
        }),
        "too_many_rows",
      );
    });

    test("50 data rows accepted", () => {
      const data = Array.from({ length: 50 }, (_, i) => ({
        x: `item-${i}`,
        y: i,
      }));
      const result = tryParseChartSpec(
        JSON.stringify({
          type: "bar",
          data,
          xKey: "x",
          series: [{ key: "y" }],
        }),
      );
      expect(result.ok).toBe(true);
    });
  });

  describe("too_many_series", () => {
    test("9 series rejected", () => {
      const series = Array.from({ length: 9 }, (_, i) => ({
        key: `s${i}`,
      }));
      const row: Record<string, unknown> = { x: "a" };
      for (const s of series) row[s.key] = 1;

      expectError(
        JSON.stringify({
          type: "bar",
          data: [row],
          xKey: "x",
          series,
        }),
        "too_many_series",
      );
    });

    test("8 series accepted", () => {
      const series = Array.from({ length: 8 }, (_, i) => ({
        key: `s${i}`,
      }));
      const row: Record<string, unknown> = { x: "a" };
      for (const s of series) row[s.key] = 1;

      const result = tryParseChartSpec(
        JSON.stringify({
          type: "bar",
          data: [row],
          xKey: "x",
          series,
        }),
      );
      expect(result.ok).toBe(true);
    });
  });

  describe("invalid_schema", () => {
    test("missing type field", () => {
      expectError(
        JSON.stringify({ data: [{ x: 1 }], xKey: "x", series: [{ key: "x" }] }),
        "invalid_schema",
      );
    });

    test("missing xKey for cartesian chart", () => {
      expectError(
        JSON.stringify({
          type: "bar",
          data: [{ month: "Jan", rev: 100 }],
          series: [{ key: "rev" }],
        }),
        "invalid_schema",
      );
    });

    test("missing series for cartesian chart", () => {
      expectError(
        JSON.stringify({
          type: "bar",
          data: [{ month: "Jan", rev: 100 }],
          xKey: "month",
        }),
        "invalid_schema",
      );
    });

    test("missing nameKey for pie chart", () => {
      expectError(
        JSON.stringify({
          type: "pie",
          data: [{ source: "A", value: 1 }],
          valueKey: "value",
        }),
        "invalid_schema",
      );
    });

    test("missing valueKey for pie chart", () => {
      expectError(
        JSON.stringify({
          type: "pie",
          data: [{ source: "A", value: 1 }],
          nameKey: "source",
        }),
        "invalid_schema",
      );
    });

    test("empty data array", () => {
      expectError(
        JSON.stringify({
          type: "bar",
          data: [],
          xKey: "x",
          series: [{ key: "y" }],
        }),
        "invalid_schema",
      );
    });

    test("non-object input (array)", () => {
      expectError("[1, 2, 3]", "invalid_schema");
    });

    test("non-object input (string)", () => {
      expectError('"just a string"', "invalid_schema");
    });

    test("height below minimum", () => {
      expectError(validBar({ height: 50 }), "invalid_schema");
    });

    test("height above maximum", () => {
      expectError(validBar({ height: 500 }), "invalid_schema");
    });
  });

  describe("superRefine: data integrity", () => {
    test("missing xKey in row", () => {
      expectError(
        JSON.stringify({
          type: "bar",
          data: [{ rev: 100 }],
          xKey: "month",
          series: [{ key: "rev" }],
        }),
        "invalid_schema",
      );
    });

    test("non-numeric series value (string)", () => {
      expectError(
        JSON.stringify({
          type: "bar",
          data: [{ month: "Jan", revenue: "four thousand" }],
          xKey: "month",
          series: [{ key: "revenue" }],
        }),
        "invalid_schema",
      );
    });

    test("non-numeric series value (NaN)", () => {
      // NaN can't be in JSON, but Infinity can't either.
      // This tests the missing key path instead.
      expectError(
        JSON.stringify({
          type: "bar",
          data: [{ month: "Jan" }],
          xKey: "month",
          series: [{ key: "revenue" }],
        }),
        "invalid_schema",
      );
    });

    test("missing nameKey in pie row", () => {
      expectError(
        JSON.stringify({
          type: "pie",
          data: [{ value: 42 }],
          nameKey: "source",
          valueKey: "value",
        }),
        "invalid_schema",
      );
    });

    test("non-numeric valueKey in pie row", () => {
      expectError(
        JSON.stringify({
          type: "pie",
          data: [{ source: "Organic", value: "forty-two" }],
          nameKey: "source",
          valueKey: "value",
        }),
        "invalid_schema",
      );
    });

    test("null series values accepted as missing data points", () => {
      const result = tryParseChartSpec(
        JSON.stringify({
          type: "bar",
          data: [
            { month: "Jan", a: 10, b: null },
            { month: "Feb", a: 20, b: 30 },
          ],
          xKey: "month",
          series: [{ key: "a" }, { key: "b" }],
        }),
      );
      expect(result.ok).toBe(true);
    });
  });
});
