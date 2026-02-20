import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Paperclip, X, FileText, Mic, Square, Loader2, Check } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import type { Attachment } from "@spaceduck/core";
import { useVoiceRecorder } from "../hooks/use-voice-recorder";

function getUploadUrl(): string {
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
  sttMaxSeconds?: number;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function ChatInput({ onSend, disabled, isStreaming, sttAvailable, sttMaxSeconds }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const recorder = useVoiceRecorder({
    languageHint: "da",
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
  const showMic = sttAvailable && !canSend && !isStreaming && recorder.state === "idle";
  const isRecording = recorder.state === "recording";
  const isProcessing = recorder.state === "processing";
  const isSuccess = recorder.state === "success";
  const isError = recorder.state === "error";

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
      <div className="max-w-3xl mx-auto">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
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

        <div className="flex items-end gap-2">
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

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || uploading}
                size="icon"
                variant="ghost"
                className="h-[44px] w-[44px] shrink-0 rounded-xl"
              >
                <Paperclip size={18} className={uploading ? "animate-pulse" : ""} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {uploading ? "Uploading..." : "Attach PDF"}
            </TooltipContent>
          </Tooltip>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isStreaming ? "Waiting for response..." : "Type a message..."}
            disabled={disabled}
            rows={1}
            className={cn(
              "flex-1 min-w-0 min-h-[44px] resize-none rounded-xl border border-input bg-background px-4 py-2.5 text-sm",
              "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "transition-colors",
            )}
          />
          {isRecording ? (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatDuration(recorder.durationMs)}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={recorder.toggle}
                    size="icon"
                    variant="destructive"
                    className="h-[44px] w-[44px] rounded-xl"
                  >
                    <Square size={18} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Stop recording</TooltipContent>
              </Tooltip>
            </div>
          ) : isProcessing ? (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted-foreground">Transcribing...</span>
              <Button
                size="icon"
                variant="secondary"
                disabled
                className="h-[44px] w-[44px] rounded-xl"
              >
                <Loader2 size={18} className="animate-spin" />
              </Button>
            </div>
          ) : isSuccess ? (
            <Button
              size="icon"
              variant="secondary"
              disabled
              className="h-[44px] w-[44px] shrink-0 rounded-xl"
            >
              <Check size={18} className="text-green-500" />
            </Button>
          ) : isError ? (
            <Button
              size="icon"
              variant="secondary"
              disabled
              className="h-[44px] w-[44px] shrink-0 rounded-xl"
            >
              <X size={18} className="text-destructive" />
            </Button>
          ) : showMic ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={recorder.toggle}
                  size="icon"
                  variant="ghost"
                  className="h-[44px] w-[44px] shrink-0 rounded-xl"
                >
                  <Mic size={18} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Dictate</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={handleSubmit}
                  disabled={!canSend}
                  size="icon"
                  variant={canSend ? "default" : "secondary"}
                  className="h-[44px] w-[44px] shrink-0 rounded-xl"
                >
                  <Send size={18} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {canSend ? "Send message" : "Type a message to send"}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <p className="text-center text-xs text-muted-foreground mt-2 max-w-3xl mx-auto">
          {sttAvailable
            ? "Shift+Enter for new line. Enter to send. Drop a PDF to attach. Click mic to dictate."
            : "Shift+Enter for new line. Enter to send. Drop a PDF to attach."}
        </p>
      </div>
    </div>
  );
}
