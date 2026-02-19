import { useState, useRef, useEffect } from "react";
import { Send } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  isStreaming?: boolean;
}

export function ChatInput({ onSend, disabled, isStreaming }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
            "flex-1 min-w-0 min-h-[44px] resize-none rounded-xl border border-input bg-background px-4 py-2.5 text-sm",
            "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "transition-colors",
          )}
        />
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
      </div>
      <p className="text-center text-xs text-muted-foreground mt-2 max-w-3xl mx-auto">
        Shift+Enter for new line. Enter to send.
      </p>
    </div>
  );
}
