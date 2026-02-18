// WebFetchTool: lightweight HTTP fetch + HTML-to-text for static pages.
// Much faster and cheaper than launching a browser. Use for server-rendered
// content, APIs, and pages that don't require JavaScript execution.

import { convert } from "html-to-text";

const DEFAULT_MAX_CHARS = 20_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; Spaceduck/1.0; +https://github.com/spaceduck)";

export interface WebFetchOptions {
  maxChars?: number;
  timeoutMs?: number;
  userAgent?: string;
}

export class WebFetchTool {
  private readonly maxChars: number;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(options: WebFetchOptions = {}) {
    this.maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  /**
   * Fetch a URL and return its content as readable text.
   * - HTML pages are converted to clean text with links preserved.
   * - JSON responses are pretty-printed.
   * - Plain text is returned as-is.
   * Returns an error description (not throw) on failure so the LLM can see what went wrong.
   */
  async fetch(url: string): Promise<string> {
    try {
      const response = await globalThis.fetch(url, {
        headers: {
          "User-Agent": this.userAgent,
          Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        return `Error: HTTP ${response.status} ${response.statusText} fetching ${url}`;
      }

      const contentType = response.headers.get("content-type") ?? "";
      const body = await response.text();

      let result: string;

      if (contentType.includes("application/json")) {
        result = this.formatJson(body, url);
      } else if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
        result = this.formatHtml(body, url);
      } else {
        // Plain text or other
        result = `URL: ${url}\nContent-Type: ${contentType}\n\n${body}`;
      }

      return this.truncate(result);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        return `Error: Request timed out after ${this.timeoutMs}ms fetching ${url}`;
      }
      if (err instanceof TypeError && (err.message.includes("fetch") || err.message.includes("network"))) {
        return `Error: Network error fetching ${url} — ${err.message}`;
      }
      return `Error: Failed to fetch ${url} — ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private formatHtml(html: string, url: string): string {
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "";

    const cleaned = stripBoilerplate(html);

    const text = convert(cleaned, {
      wordwrap: 120,
      selectors: [
        { selector: "a", options: { linkBrackets: ["[", "]"] } },
        { selector: "script", format: "skip" },
        { selector: "style", format: "skip" },
        { selector: "noscript", format: "skip" },
        { selector: "img", options: { linkBrackets: false } },
      ],
    });

    // Collapse runs of 3+ blank lines into 2
    const compact = collapseWhitespace(text);

    const header = `URL: ${url}${title ? `\nTitle: ${title}` : ""}\n\n`;
    return header + compact;
  }

  private formatJson(body: string, url: string): string {
    try {
      const parsed = JSON.parse(body);
      return `URL: ${url}\nContent-Type: application/json\n\n${JSON.stringify(parsed, null, 2)}`;
    } catch {
      return `URL: ${url}\nContent-Type: application/json\n\n${body}`;
    }
  }

  private truncate(text: string): string {
    if (text.length <= this.maxChars) return text;
    return text.slice(0, this.maxChars) + "\n\n[truncated]";
  }
}

// ── Boilerplate stripping ─────────────────────────────────────────────
// Removes common non-content elements from HTML before text conversion.
// This dramatically improves signal-to-noise ratio for LLM consumption:
//   Magasin.dk product page: 806KB HTML → 56K text → 41K navigation
//   After stripping: ~5K of actual product content

/**
 * Strip boilerplate elements (nav, header, footer, menus, ads, etc.)
 * from raw HTML, keeping only the main content.
 *
 * Strategy:
 *   1. Try to extract <main>, <article>, or role="main" content
 *   2. If found, use that as the page body
 *   3. Always strip known boilerplate tags regardless
 */
export function stripBoilerplate(html: string): string {
  // Try to extract main content area first
  const mainContent = extractMainContent(html);
  const source = mainContent ?? html;

  // Remove boilerplate elements via regex
  // (We intentionally use regex rather than a DOM parser to stay dependency-free
  // and fast — these patterns cover the vast majority of real-world sites.)
  return removeBoilerplateTags(source);
}

/**
 * Try to extract content from semantic containers.
 * Returns the innerHTML of the first match, or null.
 */
function extractMainContent(html: string): string | null {
  // Priority order: <main>, role="main", <article>
  const patterns = [
    /<main[\s>][\s\S]*?<\/main>/i,
    /<[^>]+role\s*=\s*["']main["'][^>]*>[\s\S]*?<\/[^>]+>/i,
    /<article[\s>][\s\S]*?<\/article>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[0].length > 200) {
      return match[0];
    }
  }

  return null;
}

/**
 * Remove common boilerplate HTML elements.
 * Uses non-greedy matching to avoid consuming real content.
 */
function removeBoilerplateTags(html: string): string {
  const boilerplateTags = [
    // Navigation & menus
    /<nav[\s>][\s\S]*?<\/nav>/gi,
    /<header[\s>][\s\S]*?<\/header>/gi,
    /<footer[\s>][\s\S]*?<\/footer>/gi,

    // Common boilerplate roles
    /<[^>]+role\s*=\s*["'](?:navigation|banner|contentinfo|complementary|search)["'][\s\S]*?<\/[^>]+>/gi,

    // Common boilerplate class/id patterns
    /<[^>]+(?:class|id)\s*=\s*["'][^"']*(?:cookie|consent|popup|modal|overlay|newsletter|subscribe|banner|mega-?menu|site-?header|site-?footer|breadcrumb)[\s\S]*?<\/(?:div|section|aside|dialog)>/gi,

    // Skip tags
    /<script[\s>][\s\S]*?<\/script>/gi,
    /<style[\s>][\s\S]*?<\/style>/gi,
    /<noscript[\s>][\s\S]*?<\/noscript>/gi,
    /<svg[\s>][\s\S]*?<\/svg>/gi,
    /<iframe[\s>][\s\S]*?<\/iframe>/gi,

    // HTML comments
    /<!--[\s\S]*?-->/g,
  ];

  let result = html;
  for (const pattern of boilerplateTags) {
    result = result.replace(pattern, "");
  }
  return result;
}

/**
 * Collapse runs of 3+ newlines into 2, and trim excessive whitespace
 * from each line. Keeps output compact for LLM context.
 */
function collapseWhitespace(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
