"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface EntryReference {
  entry_id: string;
  title: string | null;
  summary: string | null;
  source_url?: string;
  complexity?: string | null;
  similarity?: number;
}

export type BuilderMessage =
  | { role: "ai"; type: "text"; content: string }
  | { role: "user"; type: "text"; content: string }
  | { role: "ai"; type: "tool_activity"; toolName: string; status: "calling" | "done"; summary?: string }
  | { role: "ai"; type: "entry_cards"; entries: EntryReference[] }
  | { role: "ai"; type: "streaming"; content: string };

export function BuilderMessageBubble({ message }: { message: BuilderMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold">
            AI
          </span>
        </div>

        {message.type === "text" && (
          <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap">
            {message.content}
          </div>
        )}

        {message.type === "streaming" && (
          <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap">
            {message.content}
            <span className="inline-block w-1.5 h-4 bg-foreground/50 animate-pulse ml-0.5 align-text-bottom" />
          </div>
        )}

        {message.type === "tool_activity" && (
          <div className="rounded-xl bg-muted/50 border border-dashed px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
            {message.status === "calling" ? (
              <>
                <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                {message.toolName === "search_knowledge_base"
                  ? "Searching knowledge base..."
                  : "Loading entry details..."}
              </>
            ) : (
              <>
                <span className="text-green-500">OK</span>
                {message.summary}
              </>
            )}
          </div>
        )}

        {message.type === "entry_cards" && (
          <div className="space-y-2">
            {message.entries.map((entry) => (
              <Link
                key={entry.entry_id}
                href={`/entries/${entry.entry_id}`}
                target="_blank"
              >
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm truncate">
                          {entry.title || "Untitled"}
                        </h4>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {entry.summary || "No summary"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {entry.complexity && (
                          <Badge variant="outline" className="text-[10px]">
                            {entry.complexity}
                          </Badge>
                        )}
                        {entry.similarity && (
                          <Badge variant="secondary" className="text-[10px]">
                            {(entry.similarity * 100).toFixed(0)}%
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
