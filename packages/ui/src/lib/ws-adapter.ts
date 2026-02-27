/**
 * Unified WebSocket adapter — uses the Tauri Rust plugin when running
 * inside the desktop app, falls back to the browser-native WebSocket
 * otherwise. The Tauri plugin routes traffic through tokio-tungstenite
 * in Rust, bypassing WKWebView's problematic WebSocket implementation
 * which fails to reconnect after server restarts.
 */

const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

export interface UnifiedWs {
  send(data: string): void;
  close(): void;
  readonly readyState: number;
}

export interface UnifiedWsCallbacks {
  onopen: () => void;
  onclose: () => void;
  onerror: () => void;
  onmessage: (data: string) => void;
}

export const WS_OPEN = 1;
export const WS_CLOSED = 3;

export async function createWebSocket(
  url: string,
  callbacks: UnifiedWsCallbacks,
): Promise<UnifiedWs> {
  if (isTauri) {
    return createTauriWs(url, callbacks);
  }
  return createBrowserWs(url, callbacks);
}

function createBrowserWs(
  url: string,
  cb: UnifiedWsCallbacks,
): Promise<UnifiedWs> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);

    const handle: UnifiedWs = {
      send: (data) => ws.send(data),
      close: () => ws.close(),
      get readyState() {
        return ws.readyState;
      },
    };

    ws.onopen = () => {
      cb.onopen();
    };
    ws.onclose = () => cb.onclose();
    ws.onerror = () => cb.onerror();
    ws.onmessage = (e) => cb.onmessage(e.data as string);

    // Resolve immediately so the caller can store the handle
    resolve(handle);
  });
}

async function createTauriWs(
  url: string,
  cb: UnifiedWsCallbacks,
): Promise<UnifiedWs> {
  const { default: TauriWebSocket } = await import(
    "@tauri-apps/plugin-websocket"
  );

  let connected = false;
  let closed = false;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  let tauriWs: Awaited<ReturnType<typeof TauriWebSocket.connect>> | null =
    null;

  function triggerClose() {
    if (closed) return;
    connected = false;
    closed = true;
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    tauriWs?.disconnect().catch(() => {});
    cb.onclose();
  }

  const handle: UnifiedWs = {
    send: (data) => {
      tauriWs?.send(data).catch(() => triggerClose());
    },
    close: () => {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      closed = true;
      tauriWs?.disconnect().catch(() => {});
    },
    get readyState() {
      if (closed) return WS_CLOSED;
      if (connected) return WS_OPEN;
      return 0; // CONNECTING
    },
  };

  try {
    tauriWs = await TauriWebSocket.connect(url);
  } catch {
    // Connection failed — fire error then close, mirroring browser behavior
    setTimeout(() => {
      cb.onerror();
      cb.onclose();
    }, 0);
    return handle;
  }

  connected = true;

  tauriWs.addListener((msg) => {
    if (closed) return;
    if (msg.type === "Text" && typeof msg.data === "string") {
      cb.onmessage(msg.data);
    } else if (msg.type === "Close") {
      triggerClose();
    }
  });

  // Heartbeat: detect dead connections by attempting a Ping every 5s.
  // If send fails, the connection is dead and we trigger onclose.
  pingTimer = setInterval(() => {
    if (closed || !tauriWs) return;
    tauriWs.send({ type: "Ping", data: [] }).catch(() => triggerClose());
  }, 5000);

  // Fire onopen asynchronously to match browser WebSocket timing
  setTimeout(() => cb.onopen(), 0);

  return handle;
}
