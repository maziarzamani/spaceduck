import { describe, test, expect } from "bun:test";
import { tryParseChartSpec } from "../chart-types";

// These tests verify the integration seam between the markdown renderer
// and the chart system. They test the exact strings that react-markdown
// would pass through as code block children.

function fencedBlockContent(json: string): string {
  // react-markdown strips the fence markers and passes the raw content
  // as children, with a trailing newline
  return json + "\n";
}

describe("chart block integration seam", () => {
  test("valid chart JSON parses correctly after trailing newline strip", () => {
    const raw = fencedBlockContent(
      JSON.stringify({
        type: "bar",
        data: [{ x: "A", y: 10 }],
        xKey: "x",
        series: [{ key: "y" }],
      }),
    );
    // The message-list.tsx code calls raw.replace(/\n$/, "")
    const cleaned = raw.replace(/\n$/, "");
    const result = tryParseChartSpec(cleaned);
    expect(result.ok).toBe(true);
  });

  test("non-chart language code blocks would not be passed to ChartBlock", () => {
    const tsCode = "const x: number = 42;";
    const result = tryParseChartSpec(tsCode);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_json");
  });

  test("inline code snippets containing 'chart' do not parse as charts", () => {
    const result = tryParseChartSpec("chart");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_json");
  });

  test("children array joining produces parseable JSON", () => {
    // react-markdown can pass children as arrays
    const parts = ['{"type":"bar","data":[', '{"x":"A","y":1}', '],"xKey":"x","series":[{"key":"y"}]}'];
    const joined = parts.join("");
    const result = tryParseChartSpec(joined);
    expect(result.ok).toBe(true);
  });

  test("pretty-printed JSON from LLM parses correctly", () => {
    const prettyJson = `{
  "version": 1,
  "type": "bar",
  "title": "Monthly Revenue",
  "data": [
    { "month": "Jan", "revenue": 4000 },
    { "month": "Feb", "revenue": 3000 },
    { "month": "Mar", "revenue": 5200 }
  ],
  "xKey": "month",
  "series": [
    { "key": "revenue", "label": "Revenue" }
  ]
}`;
    const result = tryParseChartSpec(prettyJson);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.title).toBe("Monthly Revenue");
      expect(result.spec.type).toBe("bar");
    }
  });

  test("JSON with extra whitespace and newlines still parses", () => {
    const messy = `  \n  {"type":"pie","data":[{"name":"A","val":1}],"nameKey":"name","valueKey":"val"}  \n  `;
    const result = tryParseChartSpec(messy.trim());
    expect(result.ok).toBe(true);
  });
});
