import { useState, useRef, useEffect } from "react";
import { Send } from "lucide-react";
import { cn } from "../lib/utils";

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  isStreaming?: boolean;
}

export function ChatInput({ onSend, disabled, isStreaming }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || disabled || isStreaming) return;
    onSend(trimmed);
    setValue("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const canSend = value.trim().length > 0 && !disabled && !isStreaming;

  return (
    <div className="border-t border-border bg-card/50 backdrop-blur-sm px-4 py-3">
      <div className="max-w-3xl mx-auto flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? "Waiting for response..." : "Type a message..."}
          disabled={disabled}
          rows={1}
          className={cn(
            "flex-1 min-w-0 resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm leading-[1.375rem]",
            "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "transition-colors",
          )}
        />
        <button
          onClick={handleSubmit}
          disabled={!canSend}
          className={cn(
            "shrink-0 self-end h-[44px] w-[44px] flex items-center justify-center rounded-xl transition-all",
            canSend
              ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/25"
              : "bg-muted text-muted-foreground cursor-not-allowed",
          )}
        >
          <Send size={18} />
        </button>
      </div>
      <p className="text-center text-xs text-muted-foreground mt-2 max-w-3xl mx-auto">
        Shift+Enter for new line. Enter to send.
      </p>
    </div>
  );
}
