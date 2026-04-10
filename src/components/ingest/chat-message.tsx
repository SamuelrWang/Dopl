"use client";

import { useEffect, useRef } from "react";
import { ArtifactsPanel } from "./artifacts-panel";

export interface ProgressEvent {
  type:
    | "info"
    | "step_start"
    | "step_complete"
    | "step_error"
    | "detail"
    | "complete"
    | "error";
  message: string;
  step?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export type ChatMessage =
  | { role: "ai"; type: "text"; content: string }
  | { role: "user"; type: "text"; content: string }
  | {
      role: "ai";
      type: "progress";
      entryId: string;
      events: ProgressEvent[];
      status: "streaming" | "complete" | "error";
    }
  | {
      role: "ai";
      type: "artifacts";
      entryId: string;
      title: string;
      readme: string;
      agentsMd: string;
      manifest: Record<string, unknown>;
    };

const eventTypeConfig: Record<
  ProgressEvent["type"],
  { icon: string; className: string }
> = {
  info: { icon: "->", className: "text-muted-foreground" },
  step_start: { icon: ">>", className: "text-blue-400 font-medium" },
  step_complete: { icon: "OK", className: "text-green-400 font-medium" },
  step_error: { icon: "!!", className: "text-red-400 font-medium" },
  detail: { icon: "  ", className: "text-muted-foreground pl-4" },
  complete: { icon: "**", className: "text-green-400 font-bold" },
  error: { icon: "!!", className: "text-red-400 font-bold" },
};

function ProgressLog({
  events,
  status,
}: {
  events: ProgressEvent[];
  status: "streaming" | "complete" | "error";
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  return (
    <div
      ref={scrollRef}
      className="font-mono text-xs leading-relaxed max-h-[300px] overflow-y-auto bg-black/40 rounded-md p-3 space-y-0.5"
    >
      {events.map((event, i) => {
        const config = eventTypeConfig[event.type];
        const time = new Date(event.timestamp).toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        return (
          <div key={i} className={`flex gap-2 ${config.className}`}>
            <span className="text-muted-foreground shrink-0 w-[60px]">
              {time}
            </span>
            <span className="shrink-0 w-[20px] text-center">{config.icon}</span>
            <span className="break-all">{event.message}</span>
          </div>
        );
      })}

      {status === "streaming" && (
        <div className="flex gap-2 text-muted-foreground animate-pulse">
          <span className="shrink-0 w-[60px]" />
          <span className="shrink-0 w-[20px] text-center">..</span>
          <span>working...</span>
        </div>
      )}
    </div>
  );
}

export function ChatMessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm break-all">
          {message.content}
        </div>
      </div>
    );
  }

  // AI messages
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold">
            AI
          </span>
        </div>

        {message.type === "text" && (
          <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-2.5 text-sm">
            {message.content}
          </div>
        )}

        {message.type === "progress" && (
          <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-3 space-y-2">
            <ProgressLog events={message.events} status={message.status} />
          </div>
        )}

        {message.type === "artifacts" && (
          <ArtifactsPanel
            entryId={message.entryId}
            title={message.title}
            readme={message.readme}
            agentsMd={message.agentsMd}
            manifest={message.manifest}
          />
        )}
      </div>
    </div>
  );
}
