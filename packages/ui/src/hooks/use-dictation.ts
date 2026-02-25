import { useState, useRef, useCallback, useEffect } from "react";
import type { ChatInputRecorderHandle } from "../components/chat-input";

export type DictationState = "idle" | "recording" | "processing";

export interface UseDictationOptions {
  enabled: boolean;
  hotkey: string;
  languageHint?: string;
  maxSeconds?: number;
  onStateChange?: (state: DictationState) => void;
  onError?: (error: string) => void;
  onTranscribed?: (text: string) => void;
  chatRecorderRef?: React.RefObject<ChatInputRecorderHandle | null>;
}

export interface UseDictationReturn {
  state: DictationState;
  durationMs: number;
  supported: boolean;
}

function isTauriEnv(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

const TAURI_SHORTCUT = "@tauri-apps/plugin-global" + "-shortcut";

function getTranscribeUrl(): string {
  const stored = localStorage.getItem("spaceduck.gatewayUrl");
  if (stored) return `${stored}/api/stt/transcribe`;
  return "http://localhost:3000/api/stt/transcribe";
}

function getAuthToken(): string | null {
  return localStorage.getItem("spaceduck.token");
}

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
];

function selectMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  for (const mime of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "audio/webm";
}

// ── HMR-safe singleton listener for Tauri events ──
// Stored on globalThis so the same listener survives module hot-replacement.
// Only the callback ref is swapped by each hook mount.

interface DictationGlobal {
  fnListenerActive: boolean;
  onChatStart: (() => void) | null;
  onChatStop: (() => void) | null;
  onGlobalStart: (() => void) | null;
  onGlobalStop: (() => void) | null;
}

const GLOBAL_KEY = "__spaceduck_dictation__";

function getDictationGlobal(): DictationGlobal {
  const g = globalThis as any;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      fnListenerActive: false,
      onChatStart: null,
      onChatStop: null,
      onGlobalStart: null,
      onGlobalStop: null,
    };
  }
  return g[GLOBAL_KEY];
}

function ensureFnListeners() {
  const dg = getDictationGlobal();
  if (dg.fnListenerActive || !isTauriEnv()) return;
  dg.fnListenerActive = true;

  const tauriEvent = (window as any).__TAURI__?.event;
  if (!tauriEvent?.listen) {
    console.error("[dictation] Tauri event API not available");
    dg.fnListenerActive = false;
    return;
  }

  tauriEvent.listen("dictation:start-chat", () => {
    dg.onChatStart?.();
  });
  tauriEvent.listen("dictation:stop-chat", () => {
    dg.onChatStop?.();
  });
  tauriEvent.listen("dictation:start-global", () => {
    dg.onGlobalStart?.();
  });
  tauriEvent.listen("dictation:stop-global", () => {
    dg.onGlobalStop?.();
  });
}

export function useDictation(opts: UseDictationOptions): UseDictationReturn {
  const [state, setState] = useState<DictationState>("idle");
  const [durationMs, setDurationMs] = useState(0);
  const [supported] = useState(() => isTauriEnv());

  const stateRef = useRef<DictationState>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startTimeRef = useRef<number>(0);
  const mimeTypeRef = useRef<string>("audio/webm");
  const unregisterShortcutRef = useRef<(() => Promise<void>) | null>(null);

  const setStateTracked = useCallback((next: DictationState) => {
    stateRef.current = next;
    setState(next);
    opts.onStateChange?.(next);
  }, [opts.onStateChange]);

  const stopMediaTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Background/global dictation: record + transcribe + paste via clipboard.
  // Currently only reachable via non-Fn global shortcuts while app is unfocused.
  // Fn background mode is temporarily disabled (events from Rust are ignored
  // until we implement native audio capture on the Rust side).
  const sendAudioAndPaste = useCallback(async (blob: Blob) => {
    setStateTracked("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const headers: Record<string, string> = {
        "Content-Type": mimeTypeRef.current.split(";")[0],
      };
      if (opts.languageHint) {
        headers["X-STT-Language"] = opts.languageHint;
      }
      const token = getAuthToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const resp = await fetch(getTranscribeUrl(), {
        method: "POST",
        headers,
        body: blob,
        signal: controller.signal,
      });

      const data = await resp.json();

      if (!resp.ok) {
        const msg = data.message ?? data.error ?? "Transcription failed";
        opts.onError?.(msg);
        setStateTracked("idle");
        return;
      }

      const text = data.text ?? "";
      if (text) {
        try {
          const invoke = (window as any).__TAURI__?.core?.invoke;
          if (invoke) {
            await invoke("paste_transcription", { text });
          }
          opts.onTranscribed?.(text);
        } catch (err) {
          opts.onError?.(err instanceof Error ? err.message : "Paste failed");
        }
      }

      setStateTracked("idle");
      setDurationMs(0);
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setStateTracked("idle");
        setDurationMs(0);
        return;
      }
      opts.onError?.(err instanceof Error ? err.message : String(err));
      setStateTracked("idle");
      setDurationMs(0);
    } finally {
      abortRef.current = null;
    }
  }, [opts.languageHint, opts.onError, opts.onTranscribed, setStateTracked]);

  const startRecording = useCallback(async () => {
    if (stateRef.current !== "idle") return;

    chunksRef.current = [];
    mimeTypeRef.current = selectMimeType();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, { mimeType: mimeTypeRef.current });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        chunksRef.current = [];
        if (blob.size > 0) {
          sendAudioAndPaste(blob);
        } else {
          setStateTracked("idle");
          setDurationMs(0);
        }
      };

      recorder.start();
      startTimeRef.current = Date.now();
      setStateTracked("recording");
      setDurationMs(0);

      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current;
        setDurationMs(elapsed);

        if (opts.maxSeconds && elapsed >= opts.maxSeconds * 1000) {
          stopRecording();
        }
      }, 100);
    } catch (err) {
      opts.onError?.(err instanceof Error ? err.message : "Microphone access denied");
    }
  }, [opts.maxSeconds, opts.onError, sendAudioAndPaste, setStateTracked]);

  const stopRecording = useCallback(() => {
    if (stateRef.current !== "recording") return;

    clearTimer();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    stopMediaTracks();
  }, [clearTimer, stopMediaTracks]);

  // Refs for the global shortcut path (non-Fn) so the listener closure
  // always calls the latest callbacks without re-registering.
  const startRecordingRef = useRef<(() => void) | null>(null);
  const stopRecordingRef = useRef<(() => void) | null>(null);
  startRecordingRef.current = startRecording;
  stopRecordingRef.current = stopRecording;

  // ── Fn key: high-level events from Rust via globalThis singleton ──
  useEffect(() => {
    if (!supported || !opts.enabled || opts.hotkey !== "Fn") return;

    ensureFnListeners();
    const dg = getDictationGlobal();

    dg.onChatStart = () => {
      opts.chatRecorderRef?.current?.startRecording();
    };
    dg.onChatStop = () => {
      opts.chatRecorderRef?.current?.stopAndTranscribe();
    };
    // Global/background Fn dictation is disabled for now.
    // When Rust-native audio capture is implemented, these will be no-ops
    // (Rust handles the full pipeline) or will receive transcribed text.
    dg.onGlobalStart = null;
    dg.onGlobalStop = null;

    return () => {
      dg.onChatStart = null;
      dg.onChatStop = null;
      dg.onGlobalStart = null;
      dg.onGlobalStop = null;
    };
  }, [supported, opts.enabled, opts.hotkey, opts.chatRecorderRef]);

  // ── Non-Fn global shortcuts via Tauri plugin ──
  useEffect(() => {
    if (!supported || !opts.enabled || !opts.hotkey || opts.hotkey === "Fn") return;

    let cancelled = false;

    (async () => {
      try {
        const plugin = (window as any).__TAURI_PLUGIN_GLOBALSHORTCUT__ ??
          await import(/* @vite-ignore */ TAURI_SHORTCUT);
        const { register, unregister } = plugin;

        try { await unregister(opts.hotkey); } catch { /* may not be registered */ }

        await register(opts.hotkey, (event: any) => {
          if (cancelled) return;
          const chatRecorder = opts.chatRecorderRef?.current;

          if (event.state === "Pressed") {
            if (document.hasFocus() && chatRecorder) {
              chatRecorder.startRecording();
            } else {
              startRecordingRef.current?.();
            }
          } else if (event.state === "Released") {
            if (document.hasFocus() && chatRecorder) {
              chatRecorder.stopAndTranscribe();
            } else {
              stopRecordingRef.current?.();
            }
          }
        });

        if (cancelled) {
          try { await unregister(opts.hotkey); } catch { /* ignore */ }
          return;
        }
        unregisterShortcutRef.current = async () => {
          try { await unregister(opts.hotkey); } catch { /* ignore */ }
        };
      } catch (err) {
        console.error("[dictation] Failed to register global shortcut:", err);
      }
    })();

    return () => {
      cancelled = true;
      unregisterShortcutRef.current?.();
      unregisterShortcutRef.current = null;
    };
  }, [supported, opts.enabled, opts.hotkey]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimer();
      stopMediaTracks();
      abortRef.current?.abort();
    };
  }, [clearTimer, stopMediaTracks]);

  return { state, durationMs, supported };
}
