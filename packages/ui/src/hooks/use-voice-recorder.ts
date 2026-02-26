import { useState, useRef, useCallback, useEffect } from "react";

export type RecorderState = "idle" | "recording" | "processing" | "success" | "error";

export interface UseVoiceRecorderOptions {
  languageHint?: string;
  maxSeconds?: number;
  onTranscript?: (text: string) => void;
  onError?: (error: string) => void;
}

export interface UseVoiceRecorderReturn {
  state: RecorderState;
  durationMs: number;
  stream: MediaStream | null;
  toggle: () => void;
  cancel: () => void;
  startRecording: () => void;
  stopAndTranscribe: () => void;
}

function getTranscribeUrl(): string {
  const stored = localStorage.getItem("spaceduck.gatewayUrl");
  if (stored) return `${stored}/api/stt/transcribe`;
  if (typeof window !== "undefined" && "__TAURI__" in window) {
    return "http://localhost:3000/api/stt/transcribe";
  }
  return `${window.location.origin}/api/stt/transcribe`;
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

const AUTO_RESET_MS = 1500;
const STUCK_RECORDING_TIMEOUT_MS = 180_000; // 3 min auto-recovery

let nextStartId = 1;

export function useVoiceRecorder(opts: UseVoiceRecorderOptions = {}): UseVoiceRecorderReturn {
  const [state, setState] = useState<RecorderState>("idle");
  const [durationMs, setDurationMs] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const stateRef = useRef<RecorderState>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startTimeRef = useRef<number>(0);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mimeTypeRef = useRef<string>("audio/webm");
  const activeStartIdRef = useRef<number>(0);
  const stuckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setStateTracked = useCallback((next: RecorderState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const stopMediaTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  const clearStuckTimer = useCallback(() => {
    if (stuckTimerRef.current) {
      clearTimeout(stuckTimerRef.current);
      stuckTimerRef.current = null;
    }
  }, []);

  const forceReset = useCallback(() => {
    clearTimer();
    clearResetTimer();
    clearStuckTimer();
    activeStartIdRef.current = 0;

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    mediaRecorderRef.current = null;
    stopMediaTracks();
    chunksRef.current = [];

    abortRef.current?.abort();
    abortRef.current = null;

    setStateTracked("idle");
    setDurationMs(0);
  }, [clearTimer, clearResetTimer, clearStuckTimer, stopMediaTracks, setStateTracked]);

  const scheduleReset = useCallback(() => {
    clearResetTimer();
    resetTimerRef.current = setTimeout(() => {
      setStateTracked("idle");
      setDurationMs(0);
    }, AUTO_RESET_MS);
  }, [clearResetTimer, setStateTracked]);

  const sendAudio = useCallback(async (blob: Blob) => {
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
        setStateTracked("error");
        scheduleReset();
        return;
      }

      opts.onTranscript?.(data.text ?? "");
      setStateTracked("success");
      scheduleReset();
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setStateTracked("idle");
        setDurationMs(0);
        return;
      }
      opts.onError?.(err instanceof Error ? err.message : String(err));
      setStateTracked("error");
      scheduleReset();
    } finally {
      abortRef.current = null;
    }
  }, [opts.languageHint, opts.onTranscript, opts.onError, scheduleReset, setStateTracked]);

  const stopAndTranscribe = useCallback(() => {
    clearStuckTimer();
    const myStartId = activeStartIdRef.current;

    // If we're still waiting for getUserMedia, invalidate that pending start
    if (stateRef.current !== "recording") {
      activeStartIdRef.current = 0;
      return;
    }

    clearTimer();
    activeStartIdRef.current = 0;

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    stopMediaTracks();
  }, [clearTimer, clearStuckTimer, stopMediaTracks]);

  const startRecording = useCallback(async () => {
    if (stateRef.current === "recording") return;

    // Clean up any lingering state from previous cycle
    clearResetTimer();
    clearStuckTimer();
    abortRef.current?.abort();
    abortRef.current = null;

    const oldRecorder = mediaRecorderRef.current;
    if (oldRecorder && oldRecorder.state !== "inactive") {
      oldRecorder.onstop = null;
      oldRecorder.stop();
    }
    stopMediaTracks();
    chunksRef.current = [];
    mimeTypeRef.current = selectMimeType();

    // Pending-start token: if stopAndTranscribe is called before getUserMedia
    // resolves, we detect it by checking whether our startId is still active.
    const startId = nextStartId++;
    activeStartIdRef.current = startId;

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Check if stop was called while we were awaiting getUserMedia
      if (activeStartIdRef.current !== startId) {
        mediaStream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = mediaStream;
      setStream(mediaStream);

      const recorder = new MediaRecorder(mediaStream, { mimeType: mimeTypeRef.current });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        chunksRef.current = [];
        if (blob.size > 0) {
          sendAudio(blob);
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
          stopAndTranscribe();
        }
      }, 100);

      // Auto-recovery: force cancel if recording gets stuck
      stuckTimerRef.current = setTimeout(() => {
        if (stateRef.current === "recording") {
          console.warn("[voice-recorder] stuck recording detected, force resetting");
          forceReset();
        }
      }, STUCK_RECORDING_TIMEOUT_MS);
    } catch (err) {
      activeStartIdRef.current = 0;
      opts.onError?.(err instanceof Error ? err.message : "Microphone access denied");
      setStateTracked("idle");
    }
  }, [opts.maxSeconds, opts.onError, sendAudio, stopAndTranscribe, clearResetTimer, clearStuckTimer, stopMediaTracks, setStateTracked, forceReset]);

  const toggle = useCallback(() => {
    if (stateRef.current === "idle") {
      startRecording();
    } else if (stateRef.current === "recording") {
      stopAndTranscribe();
    }
  }, [startRecording, stopAndTranscribe]);

  const cancel = useCallback(() => {
    forceReset();
  }, [forceReset]);

  useEffect(() => {
    return () => {
      clearTimer();
      clearResetTimer();
      clearStuckTimer();
      stopMediaTracks();
      abortRef.current?.abort();
      activeStartIdRef.current = 0;
    };
  }, [clearTimer, clearResetTimer, clearStuckTimer, stopMediaTracks]);

  return { state, durationMs, stream, toggle, cancel, startRecording, stopAndTranscribe };
}
