export type ToolName = "web_search" | "web_answer" | "marker_scan" | "browser_navigate" | "web_fetch";

export type ToolStatus = "ok" | "error" | "not_configured" | "disabled" | "unavailable";

export interface ToolActivity {
  toolCallId: string;
  toolName: string;
  startedAt: number;
  result?: {
    content: string;
    isError: boolean;
  };
  completedAt?: number;
}

export interface ToolStatusEntry {
  tool: ToolName;
  status: ToolStatus;
  message?: string;
  lastError?: {
    message: string;
    timestamp: number;
  };
}

export interface ToolStatusResponse {
  tools: ToolStatusEntry[];
}

export interface ToolTestRequest {
  tool: ToolName;
  options?: Record<string, unknown>;
}

export interface ToolTestResponse {
  tool: ToolName;
  ok: boolean;
  message?: string;
  durationMs?: number;
}
