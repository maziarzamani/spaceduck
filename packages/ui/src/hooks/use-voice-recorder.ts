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
  toggle: () => void;
  cancel: () => void;
}

function getTranscribeUrl(): string {
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

export function useVoiceRecorder(opts: UseVoiceRecorderOptions = {}): UseVoiceRecorderReturn {
  const [state, setState] = useState<RecorderState>("idle");
  const [durationMs, setDurationMs] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startTimeRef = useRef<number>(0);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mimeTypeRef = useRef<string>("audio/webm");

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

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  const scheduleReset = useCallback(() => {
    clearResetTimer();
    resetTimerRef.current = setTimeout(() => {
      setState("idle");
      setDurationMs(0);
    }, AUTO_RESET_MS);
  }, [clearResetTimer]);

  const sendAudio = useCallback(async (blob: Blob) => {
    setState("processing");
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
        setState("error");
        scheduleReset();
        return;
      }

      opts.onTranscript?.(data.text ?? "");
      setState("success");
      scheduleReset();
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setState("idle");
        setDurationMs(0);
        return;
      }
      opts.onError?.(err instanceof Error ? err.message : String(err));
      setState("error");
      scheduleReset();
    } finally {
      abortRef.current = null;
    }
  }, [opts.languageHint, opts.onTranscript, opts.onError, scheduleReset]);

  const stopAndTranscribe = useCallback(() => {
    clearTimer();

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    stopMediaTracks();
  }, [clearTimer, stopMediaTracks]);

  const startRecording = useCallback(async () => {
    clearResetTimer();
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
          sendAudio(blob);
        } else {
          setState("idle");
          setDurationMs(0);
        }
      };

      recorder.start();
      startTimeRef.current = Date.now();
      setState("recording");
      setDurationMs(0);

      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current;
        setDurationMs(elapsed);

        if (opts.maxSeconds && elapsed >= opts.maxSeconds * 1000) {
          stopAndTranscribe();
        }
      }, 100);
    } catch (err) {
      opts.onError?.(err instanceof Error ? err.message : "Microphone access denied");
      setState("idle");
    }
  }, [opts.maxSeconds, opts.onError, sendAudio, stopAndTranscribe, clearResetTimer]);

  const toggle = useCallback(() => {
    if (state === "idle") {
      startRecording();
    } else if (state === "recording") {
      stopAndTranscribe();
    }
  }, [state, startRecording, stopAndTranscribe]);

  const cancel = useCallback(() => {
    clearTimer();
    clearResetTimer();

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    stopMediaTracks();
    chunksRef.current = [];

    abortRef.current?.abort();
    abortRef.current = null;

    setState("idle");
    setDurationMs(0);
  }, [clearTimer, clearResetTimer, stopMediaTracks]);

  useEffect(() => {
    return () => {
      clearTimer();
      clearResetTimer();
      stopMediaTracks();
      abortRef.current?.abort();
    };
  }, [clearTimer, clearResetTimer, stopMediaTracks]);

  return { state, durationMs, toggle, cancel };
}
