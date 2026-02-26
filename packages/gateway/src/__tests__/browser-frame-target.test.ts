import { describe, it, expect, mock } from "bun:test";
import { createBrowserFrameTarget } from "../browser-frame-target";

function createMockWs() {
  const calls: string[] = [];
  return {
    ws: { send(data: string) { calls.push(data); } },
    calls,
  };
}

describe("createBrowserFrameTarget", () => {
  it("onFrame does nothing when target.ws is null", () => {
    const { onFrame } = createBrowserFrameTarget();
    onFrame({ base64: "abc", format: "jpeg", url: "https://example.com" });
  });

  it("onFrame sends browser.frame envelope when ws is set", () => {
    const { target, onFrame } = createBrowserFrameTarget();
    const { ws, calls } = createMockWs();
    target.ws = ws;
    target.requestId = "req-42";

    onFrame({ base64: "AQID", format: "jpeg", url: "https://example.com" });

    expect(calls).toHaveLength(1);
    const envelope = JSON.parse(calls[0]);
    expect(envelope).toEqual({
      v: 1,
      type: "browser.frame",
      requestId: "req-42",
      data: "AQID",
      format: "jpeg",
      url: "https://example.com",
    });
  });

  it("onFrame sends closed envelope", () => {
    const { target, onFrame } = createBrowserFrameTarget();
    const { ws, calls } = createMockWs();
    target.ws = ws;
    target.requestId = "req-99";

    onFrame({ closed: true });

    expect(calls).toHaveLength(1);
    const envelope = JSON.parse(calls[0]);
    expect(envelope).toEqual({
      v: 1,
      type: "browser.frame",
      requestId: "req-99",
      closed: true,
    });
  });

  it("clearing target.ws stops delivery", () => {
    const { target, onFrame } = createBrowserFrameTarget();
    const { ws, calls } = createMockWs();
    target.ws = ws;
    target.requestId = "req-1";

    onFrame({ base64: "first", format: "jpeg", url: "https://a.com" });
    expect(calls).toHaveLength(1);

    target.ws = null;
    onFrame({ base64: "second", format: "jpeg", url: "https://b.com" });
    expect(calls).toHaveLength(1);
  });
});
