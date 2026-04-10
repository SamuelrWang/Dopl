"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChatMessageBubble,
  type ChatMessage,
  type ProgressEvent,
} from "./chat-message";

const WELCOME_MESSAGE: ChatMessage = {
  role: "ai",
  type: "text",
  content:
    "Paste a link to a post (X, Instagram, or any URL) and I'll extract everything from it \u2014 text, images, linked repos, the works. I'll turn it into a searchable knowledge package with a README, setup instructions, and manifest.",
};

export function IngestChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const fetchArtifacts = useCallback(async (entryId: string) => {
    try {
      const res = await fetch(`/api/entries/${entryId}`);
      if (!res.ok) return;
      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          type: "artifacts",
          entryId,
          title: data.title || "Untitled Setup",
          readme: data.readme || "",
          agentsMd: data.agents_md || "",
          manifest: data.manifest || {},
        },
      ]);
    } catch {
      // Entry fetch failed — user can still view via the entry page
    }
  }, []);

  const connectToStream = useCallback(
    (entryId: string) => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      // Add a progress message
      const progressIndex =
        messages.length + 1; // +1 because user message was just added
      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          type: "progress",
          entryId,
          events: [],
          status: "streaming" as const,
        },
      ]);

      const es = new EventSource(`/api/ingest/${entryId}/stream`);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const data: ProgressEvent = JSON.parse(event.data);

          setMessages((prev) => {
            const updated = [...prev];
            // Find the last progress message for this entry
            const idx = updated.findLastIndex(
              (m) =>
                m.role === "ai" &&
                m.type === "progress" &&
                m.entryId === entryId
            );
            if (idx === -1) return prev;

            const msg = updated[idx];
            if (msg.type !== "progress") return prev;

            updated[idx] = {
              ...msg,
              events: [...msg.events, data],
              status:
                data.type === "complete"
                  ? "complete"
                  : data.type === "error"
                    ? "error"
                    : "streaming",
            };
            return updated;
          });

          if (data.type === "complete") {
            es.close();
            eventSourceRef.current = null;
            setIsProcessing(false);
            // Fetch the generated artifacts
            fetchArtifacts(entryId);
          }

          if (data.type === "error") {
            es.close();
            eventSourceRef.current = null;
            setIsProcessing(false);
            setMessages((prev) => [
              ...prev,
              {
                role: "ai",
                type: "text",
                content: `Something went wrong: ${data.message}`,
              },
            ]);
          }
        } catch {
          // Ignore parse errors (keepalive comments)
        }
      };

      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          eventSourceRef.current = null;
          setIsProcessing(false);
        }
      };
    },
    [messages.length, fetchArtifacts]
  );

  async function handleSend() {
    const url = input.trim();
    if (!url || isProcessing) return;

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "user", type: "text", content: url },
        {
          role: "ai",
          type: "text",
          content: "That doesn't look like a valid URL. Please paste a full link starting with https://",
        },
      ]);
      return;
    }

    setInput("");
    setIsProcessing(true);

    // Add user message
    setMessages((prev) => [
      ...prev,
      { role: "user", type: "text", content: url },
    ]);

    try {
      const response = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          content: {},
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || "Ingestion failed");
      }

      // Connect to SSE stream for live progress
      connectToStream(data.entry_id);
    } catch (err) {
      setIsProcessing(false);
      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          type: "text",
          content: `Failed to start ingestion: ${err instanceof Error ? err.message : "Unknown error"}`,
        },
      ]);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6 space-y-4"
      >
        {messages.map((msg, i) => (
          <ChatMessageBubble key={i} message={msg} />
        ))}
      </div>

      {/* Input area */}
      <div className="border-t bg-background p-4">
        <div className="flex gap-2 max-w-3xl mx-auto">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isProcessing
                ? "Ingestion in progress..."
                : "Paste a URL (X, Instagram, or any link)..."
            }
            disabled={isProcessing}
            className="flex-1"
          />
          <Button
            onClick={handleSend}
            disabled={isProcessing || !input.trim()}
          >
            {isProcessing ? "Processing..." : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
