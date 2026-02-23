const isTauri =
  typeof window !== "undefined" && "__TAURI__" in window;

/**
 * Open a URL in the user's default browser.
 * Uses the Tauri opener plugin when running inside a Tauri webview,
 * otherwise falls back to window.open().
 */
export async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    const invoke = (window as any).__TAURI__?.core?.invoke;
    if (invoke) {
      await invoke("plugin:opener|open_url", { url });
      return;
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
