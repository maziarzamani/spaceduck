import { useEffect, useRef, useCallback } from "react";
import type { Message } from "@spaceduck/core";
import type { PendingStream } from "../hooks/use-spaceduck-ws";
import type { ToolActivity } from "../lib/tool-types";
import { cn } from "../lib/utils";
import { User, ChevronRight, Wrench, Loader2 } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SpaceduckLogo } from "./spaceduck-logo";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { ScrollArea } from "../ui/scroll-area";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "../ui/collapsible";
import { openExternal } from "../lib/open-external";
import { ChartBlock } from "../ui/chart-block";

/**
 * Normalizes ```chart {json}``` (same-line) into a proper fenced block so
 * react-markdown recognizes it as language-chart.  Models sometimes paste
 * the JSON on the opening-fence line instead of below it.
 */
function normalizeChartFences(md: string): string {
  return md.replace(
    /```chart[ \t]+(\{.*\})[ \t]*```|```chart[ \t]+(\{.*\})[ \t]*\n```/gm,
    (_match, inline: string | undefined, nextline: string | undefined) =>
      "```chart\n" + (inline ?? nextline) + "\n```",
  );
}

interface MessageListProps {
  messages: Message[];
  pendingStream: PendingStream | null;
  toolActivities?: ToolActivity[];
}

// ── Thinking block (collapsible intermediate messages) ───────────────

function ThinkingBlock({ messages }: { messages: Message[] }) {
  const toolNames = messages
    .flatMap((m) => m.toolCalls ?? [])
    .map((tc) => tc.name);
  const uniqueTools = [...new Set(toolNames)];
  const summary =
    uniqueTools.length > 0
      ? `Used ${uniqueTools.length} tool${uniqueTools.length > 1 ? "s" : ""}: ${uniqueTools.join(", ")}`
      : "Thinking...";

  return (
    <div className="flex gap-3 px-4 py-1.5 max-w-3xl mx-auto w-full justify-start">
      <div className="w-8 shrink-0" />
      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group">
          <ChevronRight
            size={14}
            className="transition-transform group-data-[state=open]:rotate-90"
          />
          <Wrench size={12} />
          <span>{summary}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="text-xs text-muted-foreground mt-1.5 ml-5 space-y-1 border-l border-border pl-2">
            {messages.map((m) =>
              m.content.trim() ? (
                <p key={m.id} className="whitespace-pre-wrap opacity-70">
                  {m.content}
                </p>
              ) : null,
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/** Live thinking indicator shown while tools are executing during streaming. */
function StreamingThinkingBlock({ activities }: { activities: ToolActivity[] }) {
  const uniqueTools = [...new Set(activities.map((a) => a.toolName))];
  const pending = activities.filter((a) => !a.completedAt);
  const label = pending.length > 0
    ? `Running ${pending[pending.length - 1].toolName}...`
    : `Used ${uniqueTools.length} tool${uniqueTools.length > 1 ? "s" : ""}: ${uniqueTools.join(", ")}`;

  return (
    <div className="flex gap-3 px-4 py-1.5 max-w-3xl mx-auto w-full justify-start">
      <div className="w-8 shrink-0" />
      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group">
          <ChevronRight
            size={14}
            className="transition-transform group-data-[state=open]:rotate-90"
          />
          {pending.length > 0 ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Wrench size={12} />
          )}
          <span>{label}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="text-xs text-muted-foreground mt-1.5 ml-5 space-y-0.5 border-l border-border pl-2">
            {activities.map((a) => (
              <p key={a.toolCallId} className="opacity-70">
                {a.toolName}
                {a.completedAt ? (a.result?.isError ? " — failed" : " — done") : " — running..."}
              </p>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// ── Group messages: consecutive intermediate rounds → ThinkingBlock ──

type DisplayItem =
  | { kind: "message"; message: Message }
  | { kind: "thinking"; messages: Message[] };

function groupMessages(messages: Message[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  let thinkingBatch: Message[] = [];

  function flushThinking() {
    if (thinkingBatch.length > 0) {
      items.push({ kind: "thinking", messages: thinkingBatch });
      thinkingBatch = [];
    }
  }

  for (const msg of messages) {
    const isIntermediate =
      (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) ||
      msg.role === "tool";

    if (isIntermediate) {
      thinkingBatch.push(msg);
    } else {
      flushThinking();
      items.push({ kind: "message", message: msg });
    }
  }
  flushThinking();
  return items;
}

function MessageBubble({ message, isStreaming }: { message: Message; isStreaming?: boolean }) {
  const isUser = message.role === "user";

  const handleLinkClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      const href = e.currentTarget.href;
      if (href) {
        e.preventDefault();
        openExternal(href);
      }
    },
    [],
  );

  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-3 max-w-3xl mx-auto w-full",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {!isUser && (
        <Avatar className="bg-transparent">
          <AvatarFallback className="bg-transparent">
            <SpaceduckLogo size={32} />
          </AvatarFallback>
        </Avatar>
      )}

      <div
        className={cn(
          "rounded-2xl px-4 py-2.5 max-w-[80%] text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none [&_pre]:bg-background/50 [&_pre]:rounded-lg [&_pre]:p-3 [&_code]:text-primary [&_code]:font-mono [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_a]:text-primary [&_a]:underline [&_table]:w-full [&_table]:border-collapse [&_table]:my-2 [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-1.5 [&_th]:bg-background/30 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children, ...rest }) => (
                  <a {...rest} href={href} onClick={handleLinkClick}>
                    {children}
                  </a>
                ),
                code: ({ className, children, ...rest }) => {
                  if (className === "language-chart") {
                    const raw = Array.isArray(children)
                      ? children.join("")
                      : String(children ?? "");
                    return <ChartBlock raw={raw.replace(/\n$/, "")} />;
                  }
                  return <code className={className} {...rest}>{children}</code>;
                },
              }}
            >{normalizeChartFences(message.content)}</Markdown>
            {isStreaming && (
              <span className="inline-block w-1.5 h-4 bg-primary animate-pulse ml-0.5 rounded-sm" />
            )}
          </div>
        )}
      </div>

      {isUser && (
        <Avatar className="bg-secondary">
          <AvatarFallback className="bg-secondary">
            <User size={16} className="text-muted-foreground" />
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}

export function MessageList({ messages, pendingStream, toolActivities }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);

  useEffect(() => {
    if (!bottomRef.current) return;
    const isConversationSwitch = prevMsgCountRef.current === 0 && messages.length > 0;
    const behavior = isConversationSwitch ? "instant" : "smooth";
    bottomRef.current.scrollIntoView({ behavior });
    prevMsgCountRef.current = messages.length;
  }, [messages]);

  useEffect(() => {
    if (messages.length === 0) {
      prevMsgCountRef.current = 0;
    }
  }, [messages.length]);

  useEffect(() => {
    if (pendingStream?.content) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [pendingStream?.content]);

  if (messages.length === 0 && !pendingStream) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <SpaceduckLogo size={160} className="mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-1">Welcome to spaceduck</h2>
          <p className="text-sm text-muted-foreground max-w-xs">
            Start a conversation by typing a message below.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="py-4">
        {groupMessages(messages).map((item) =>
          item.kind === "thinking" ? (
            <ThinkingBlock
              key={item.messages[0].id}
              messages={item.messages}
            />
          ) : (
            <MessageBubble key={item.message.id} message={item.message} />
          ),
        )}

        {pendingStream && toolActivities && toolActivities.length > 0 && (
          <StreamingThinkingBlock activities={toolActivities} />
        )}

        {pendingStream && (
          <MessageBubble
            message={{
              id: `stream-${pendingStream.requestId}`,
              role: "assistant",
              content: pendingStream.content || "Thinking...",
              timestamp: Date.now(),
            }}
            isStreaming
          />
        )}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
