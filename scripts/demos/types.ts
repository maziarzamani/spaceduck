import type { Page } from "playwright";

export interface DemoScenario {
  /** Short kebab-case name used for filenames (e.g. "chat-flow") */
  name: string;
  /** Human-readable description */
  description: string;
  /** Viewport size for recording */
  viewport?: { width: number; height: number };
  /** Run the demo — navigate, click, type, wait */
  run: (page: Page, baseUrl: string) => Promise<void>;
}
