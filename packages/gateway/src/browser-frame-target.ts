import type { WsServerEnvelope } from "@spaceduck/core";
import type { ScreencastFrame } from "@spaceduck/tool-browser";

export interface BrowserFrameTarget {
  ws: { send(data: string): void } | null;
  requestId: string;
  conversationId: string;
}

export function createBrowserFrameTarget(): {
  target: BrowserFrameTarget;
  onFrame: (conversationId: string, frame: ScreencastFrame | { closed: true }) => void;
} {
  const target: BrowserFrameTarget = { ws: null, requestId: "", conversationId: "" };

  function onFrame(conversationId: string, frame: ScreencastFrame | { closed: true }): void {
    if (!target.ws || target.conversationId !== conversationId) return;

    let envelope: WsServerEnvelope;
    if ("closed" in frame) {
      envelope = { v: 1, type: "browser.frame", requestId: target.requestId, closed: true };
    } else {
      envelope = {
        v: 1,
        type: "browser.frame",
        requestId: target.requestId,
        data: frame.base64,
        format: frame.format,
        url: frame.url,
      };
    }
    target.ws.send(JSON.stringify(envelope));
  }

  return { target, onFrame };
}
