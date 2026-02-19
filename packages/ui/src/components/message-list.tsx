import { useEffect, useRef } from "react";
import type { Message } from "@spaceduck/core";
import type { PendingStream } from "../hooks/use-spaceduck-ws";
import { cn } from "../lib/utils";
import { Bot, User } from "lucide-react";
import Markdown from "react-markdown";
import { SpaceduckLogo } from "./spaceduck-logo";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { ScrollArea } from "../ui/scroll-area";

interface MessageListProps {
  messages: Message[];
  pendingStream: PendingStream | null;
}

function MessageBubble({ message, isStreaming }: { message: Message; isStreaming?: boolean }) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-3 max-w-3xl mx-auto w-full",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {!isUser && (
        <Avatar className="bg-primary/20">
          <AvatarFallback className="bg-primary/20">
            <Bot size={16} className="text-primary" />
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
          <div className="prose prose-invert prose-sm max-w-none [&_pre]:bg-background/50 [&_pre]:rounded-lg [&_pre]:p-3 [&_code]:text-primary [&_code]:font-mono [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_a]:text-primary [&_a]:underline">
            <Markdown
              components={{
                a: ({ href, children, ...rest }) => (
                  <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ),
              }}
            >{message.content}</Markdown>
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

export function MessageList({ messages, pendingStream }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingStream?.content]);

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
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

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
