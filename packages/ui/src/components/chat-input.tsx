import { useState, useRef, useEffect, useCallback } from "react";
import { ArrowUp, Paperclip, X, FileText, Mic, Check, Loader2 } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { LiveWaveform } from "../ui/live-waveform";
import type { Attachment } from "@spaceduck/core";
import { useVoiceRecorder } from "../hooks/use-voice-recorder";

function getUploadUrl(): string {
  const stored = localStorage.getItem("spaceduck.gatewayUrl");
  if (stored) return `${stored}/api/upload`;
  if (typeof window !== "undefined" && "__TAURI__" in window) {
    return "http://localhost:3000/api/upload";
  }
  return `${window.location.origin}/api/upload`;
}

interface ChatInputProps {
  onSend: (content: string, attachments?: Attachment[]) => void;
  disabled?: boolean;
  isStreaming?: boolean;
  sttAvailable?: boolean;
  sttLanguage?: string;
  sttMaxSeconds?: number;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function ChatInput({ onSend, disabled, isStreaming, sttAvailable, sttLanguage, sttMaxSeconds }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const recorder = useVoiceRecorder({
    languageHint: sttLanguage,
    maxSeconds: sttMaxSeconds,
    onTranscript: (text) => {
      setValue((prev) => (prev ? prev + "\n" + text : text));
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
    onError: (err) => console.error("[stt]", err),
  });

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  async function uploadFile(file: File): Promise<Attachment | null> {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const resp = await fetch(getUploadUrl(), { method: "POST", body: formData });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: "Upload failed" }));
        console.error("[upload]", body.error);
        return null;
      }
      return (await resp.json()) as Attachment;
    } catch (err) {
      console.error("[upload]", err);
      return null;
    }
  }

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setUploading(true);
    try {
      const results = await Promise.all(
        Array.from(files)
          .filter((f) => f.type === "application/pdf" || f.name.endsWith(".pdf"))
          .map(uploadFile),
      );
      const uploaded = results.filter((r): r is Attachment => r !== null);
      if (uploaded.length) {
        setAttachments((prev) => [...prev, ...uploaded]);
      }
    } finally {
      setUploading(false);
    }
  }, []);

  function handleSubmit() {
    const trimmed = value.trim();
    if ((!trimmed && !attachments.length) || disabled || isStreaming) return;
    onSend(trimmed || "(attached file)", attachments.length ? attachments : undefined);
    setValue("");
    setAttachments([]);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) {
      handleFiles(e.dataTransfer.files);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
  }

  const canSend = (value.trim().length > 0 || attachments.length > 0) && !disabled && !isStreaming && !uploading;
  const isRecording = recorder.state === "recording";
  const isProcessing = recorder.state === "processing";
  const showMic = sttAvailable && !isStreaming;

  return (
    <div
      className={cn(
        "border-t border-border bg-card/50 backdrop-blur-sm px-4 py-3 transition-colors",
        dragOver && "ring-2 ring-ring ring-inset bg-accent/20",
      )}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div className="max-w-3xl mx-auto flex flex-col gap-2">
        {/* Attachment pills */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 text-xs"
              >
                <FileText size={14} className="text-muted-foreground shrink-0" />
                <span className="truncate max-w-[160px]">{att.filename}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(att.id)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-destructive/20 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) {
              handleFiles(e.target.files);
              e.target.value = "";
            }
          }}
        />

        {/* Row 1: Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? "Waiting for response..." : "Type a message..."}
          disabled={disabled || isRecording || isProcessing}
          rows={1}
          className={cn(
            "w-full min-h-[44px] resize-none rounded-xl border border-input bg-background px-4 py-2.5 text-sm",
            "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "transition-colors",
          )}
        />

        {/* Row 2: Action bar */}
        {isRecording ? (
          /* ── Recording mode: [X cancel] [waveform + duration] [■ stop] ── */
          <div className="flex items-center gap-2 h-[40px]">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={recorder.cancel}
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground hover:text-destructive"
                >
                  <X size={18} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Cancel</TooltipContent>
            </Tooltip>

            <div className="flex-1 flex items-center gap-2 min-w-0">
              <div className="relative flex-1 min-w-0 h-7 rounded-lg bg-muted/40 overflow-hidden flex items-center px-2">
                <div className="absolute inset-0 bg-destructive/10 animate-pulse rounded-lg" />
                <LiveWaveform
                  mediaStream={recorder.stream}
                  active={isRecording}
                  mode="scrolling"
                  barWidth={3}
                  barGap={1}
                  barRadius={4}
                  fadeEdges={true}
                  fadeWidth={24}
                  sensitivity={1.8}
                  smoothingTimeConstant={0.85}
                  height={28}
                  historySize={120}
                  className="relative z-10 flex-1"
                />
              </div>
              <span className="text-xs font-medium text-muted-foreground tabular-nums shrink-0">
                {formatDuration(recorder.durationMs)}
              </span>
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={recorder.toggle}
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 shrink-0 rounded-xl bg-foreground text-background hover:bg-foreground/90"
                >
                  <Check size={18} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop & transcribe</TooltipContent>
            </Tooltip>
          </div>
        ) : isProcessing ? (
          /* ── Processing mode: [waveform processing animation + "Transcribing..."] ── */
          <div className="flex items-center gap-2 h-[40px]">
            <div className="flex-1 min-w-0 h-7 rounded-lg bg-muted/40 overflow-hidden flex items-center px-2">
              <LiveWaveform
                active={false}
                processing={true}
                mode="scrolling"
                barWidth={3}
                barGap={1}
                barRadius={4}
                fadeEdges={true}
                fadeWidth={24}
                height={28}
                className="flex-1"
              />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Loader2 size={14} className="animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Transcribing…</span>
            </div>
          </div>
        ) : (
          /* ── Idle mode: [Paperclip] ... [Mic] [Send] ── */
          <div className="flex items-center h-[40px]">
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={disabled || uploading}
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 shrink-0 rounded-xl"
                  >
                    <Paperclip size={18} className={uploading ? "animate-pulse" : ""} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {uploading ? "Uploading…" : "Attach PDF"}
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="flex-1" />

            <div className="flex items-center gap-1">
              {showMic && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={recorder.toggle}
                      size="icon"
                      variant="ghost"
                      className="h-9 w-9 shrink-0 rounded-xl"
                    >
                      <Mic size={18} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Dictate</TooltipContent>
                </Tooltip>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={handleSubmit}
                    disabled={!canSend}
                    size="icon"
                    variant="ghost"
                    className={cn(
                      "h-9 w-9 shrink-0 rounded-xl transition-colors",
                      canSend && "bg-foreground text-background hover:bg-foreground/90",
                    )}
                  >
                    <ArrowUp size={18} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {canSend ? "Send message" : "Type a message to send"}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
