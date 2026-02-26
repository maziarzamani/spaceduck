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

// HMR-safe singleton listener for Tauri Fn-key events.
// Stored on globalThis so the same listener survives module hot-replacement.
interface DictationGlobal {
  fnListenerActive: boolean;
  onChatStart: (() => void) | null;
  onChatStop: (() => void) | null;
}

const GLOBAL_KEY = "__spaceduck_dictation__";

function getDictationGlobal(): DictationGlobal {
  const g = globalThis as any;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      fnListenerActive: false,
      onChatStart: null,
      onChatStop: null,
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
}

export function useDictation(opts: UseDictationOptions): UseDictationReturn {
  const [state, setState] = useState<DictationState>("idle");
  const [durationMs, setDurationMs] = useState(0);
  const [supported] = useState(() => isTauriEnv());

  const stateRef = useRef<DictationState>("idle");

  const setStateTracked = useCallback((next: DictationState) => {
    stateRef.current = next;
    setState(next);
    opts.onStateChange?.(next);
  }, [opts.onStateChange]);

  // Fn key: high-level events from Rust via globalThis singleton
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

    return () => {
      dg.onChatStart = null;
      dg.onChatStop = null;
    };
  }, [supported, opts.enabled, opts.hotkey, opts.chatRecorderRef]);

  return { state, durationMs, supported };
}
