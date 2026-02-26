import type { WsServerEnvelope } from "@spaceduck/core";
import type { ScreencastFrame } from "@spaceduck/tool-browser";

export interface BrowserFrameTarget {
  ws: { send(data: string): void } | null;
  requestId: string;
}

export function createBrowserFrameTarget(): {
  target: BrowserFrameTarget;
  onFrame: (frame: ScreencastFrame | { closed: true }) => void;
} {
  const target: BrowserFrameTarget = { ws: null, requestId: "" };

  function onFrame(frame: ScreencastFrame | { closed: true }): void {
    if (!target.ws) return;

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
