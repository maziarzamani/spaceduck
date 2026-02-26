import { useState, useRef, useCallback, useEffect } from "react";
import { LiveWaveform } from "./live-waveform";

export type PillState = "idle" | "recording" | "processing";

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

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function DictationPill() {
  const [state, setState] = useState<PillState>("idle");
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<PillState>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const mimeTypeRef = useRef<string>("audio/webm");

  const setTracked = useCallback((next: PillState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const sendAndPaste = useCallback(async (blob: Blob) => {
    setTracked("processing");

    try {
      const headers: Record<string, string> = {
        "Content-Type": mimeTypeRef.current.split(";")[0],
      };
      const lang = localStorage.getItem("spaceduck.dictation.language");
      if (lang) headers["X-STT-Language"] = lang;
      const token = getAuthToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const resp = await fetch(getTranscribeUrl(), {
        method: "POST",
        headers,
        body: blob,
      });
      const data = await resp.json();

      if (!resp.ok) {
        setError(data.message ?? data.error ?? "Transcription failed");
        setTracked("idle");
        setDurationMs(0);
        return;
      }

      const text = data.text ?? "";
      if (text) {
        const invoke = (window as any).__TAURI__?.core?.invoke;
        if (invoke) await invoke("paste_transcription", { text });
      }

      setTracked("idle");
      setDurationMs(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTracked("idle");
      setDurationMs(0);
    }
  }, [setTracked]);

  const handleStreamReady = useCallback((stream: MediaStream) => {
    if (stateRef.current !== "recording") return;
    chunksRef.current = [];
    mimeTypeRef.current = selectMimeType();

    const recorder = new MediaRecorder(stream, { mimeType: mimeTypeRef.current });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
      chunksRef.current = [];
      if (blob.size > 0) {
        sendAndPasteRef.current(blob);
      } else {
        setTracked("idle");
        setDurationMs(0);
      }
    };

    recorder.start();
    startTimeRef.current = Date.now();
    setDurationMs(0);

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      setDurationMs(elapsed);
      if (elapsed >= 120_000) stopRecordingRef.current();
    }, 100);
  }, [setTracked]);

  const sendAndPasteRef = useRef(sendAndPaste);
  sendAndPasteRef.current = sendAndPaste;
  const handleStreamReadyRef = useRef(handleStreamReady);
  handleStreamReadyRef.current = handleStreamReady;
  const stableOnStreamReady = useCallback((stream: MediaStream) => {
    handleStreamReadyRef.current(stream);
  }, []);
  const stableOnError = useCallback((err: unknown) => {
    if (err instanceof Error) setError(err.message);
  }, []);

  const startRecording = useCallback(() => {
    if (stateRef.current !== "idle") return;
    setError(null);
    setTracked("recording");
  }, [setTracked]);

  const stopRecording = useCallback(() => {
    if (stateRef.current !== "recording") return;
    clearTimer();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    mediaRecorderRef.current = null;
  }, [clearTimer]);

  const startRef = useRef(startRecording);
  const stopRef = useRef(stopRecording);
  const stopRecordingRef = useRef(stopRecording);
  startRef.current = startRecording;
  stopRef.current = stopRecording;
  stopRecordingRef.current = stopRecording;

  useEffect(() => {
    const tauriEvent = (window as any).__TAURI__?.event;
    if (!tauriEvent?.listen) return;

    const unsubs: Array<() => void> = [];

    tauriEvent.listen("dictation:start-global", () => {
      startRef.current();
    }).then((u: () => void) => unsubs.push(u));

    tauriEvent.listen("dictation:stop-global", () => {
      stopRef.current();
    }).then((u: () => void) => unsubs.push(u));

    return () => { unsubs.forEach((u) => u()); };
  }, []);

  useEffect(() => {
    return () => { clearTimer(); };
  }, [clearTimer]);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";

    const invoke = (window as any).__TAURI__?.core?.invoke;
    if (!invoke) return;

    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
      invoke("plugin:window|start_dragging").catch(() => {});
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  const bg =
    state === "recording"
      ? "bg-black/80"
      : state === "processing"
        ? "bg-black/80"
        : "bg-black/60";

  return (
    <div className="w-screen h-screen flex items-center justify-center p-1 select-none">
      <div
        className={`flex items-center justify-center gap-2 w-full h-full rounded-full px-4 text-white text-xs font-medium shadow-lg backdrop-blur-md transition-all duration-300 ${bg}`}
      >
        <LiveWaveform
          active={state === "recording"}
          processing={state === "processing"}
          height={28}
          barWidth={2}
          barGap={1}
          barColor="white"
          fadeEdges={true}
          fadeWidth={16}
          mode="static"
          sensitivity={1.2}
          onStreamReady={stableOnStreamReady}
          onError={stableOnError as any}
        />
        {state === "recording" && (
          <span className="tabular-nums text-white/90 shrink-0">{formatDuration(durationMs)}</span>
        )}
        {state === "processing" && (
          <span className="text-white/70 shrink-0">...</span>
        )}
        {state === "idle" && (
          <span className="text-white/50 shrink-0">fn</span>
        )}
        {error && (
          <span className="text-red-300 text-[10px] truncate max-w-[80px] shrink-0" title={error}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
