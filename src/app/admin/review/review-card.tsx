"use client";

import { useState } from "react";
import { Button } from "@/shared/ui/button";

interface Entry {
  id: string;
  title: string | null;
  summary: string | null;
  source_url: string | null;
  source_platform: string | null;
  source_author: string | null;
  thumbnail_url: string | null;
  use_case: string | null;
  complexity: string | null;
  content_type: string | null;
  status: string | null;
  moderation_status: string | null;
  created_at: string | null;
  readme: string | null;
}

interface Props {
  entry: Entry;
  ingesterEmail: string | null;
}

export function ReviewCard({ entry, ingesterEmail }: Props) {
  const [state, setState] = useState<"idle" | "pending" | "approved" | "denied" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showReadme, setShowReadme] = useState(false);

  async function act(action: "approve" | "deny") {
    setState("pending");
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/admin/entries/${entry.id}/${action}`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `Request failed: ${res.status}`);
      }
      setState(action === "approve" ? "approved" : "denied");
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
    }
  }

  // Optimistic: once acted on, collapse the card.
  if (state === "approved" || state === "denied") {
    return (
      <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 text-sm text-text-tertiary italic">
        {state === "approved" ? "Approved" : "Denied"} — {entry.title || entry.source_url}
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-5 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-medium text-text-primary truncate">
            {entry.title || "Untitled"}
          </h2>
          {entry.summary && (
            <p className="text-sm text-text-secondary mt-1 line-clamp-3">{entry.summary}</p>
          )}
        </div>
        {entry.thumbnail_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.thumbnail_url}
            alt=""
            className="w-20 h-20 rounded-lg object-cover border border-white/[0.08] flex-shrink-0"
          />
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-tertiary">
        {entry.source_url && (
          <a
            href={entry.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-secondary hover:text-text-primary underline underline-offset-2 truncate max-w-[40ch]"
          >
            {entry.source_url}
          </a>
        )}
        {entry.source_platform && <span>platform: {entry.source_platform}</span>}
        {entry.content_type && <span>type: {entry.content_type}</span>}
        {entry.use_case && <span>use case: {entry.use_case}</span>}
        {entry.complexity && <span>complexity: {entry.complexity}</span>}
        {entry.status && entry.status !== "complete" && (
          <span className="text-amber-400">ingestion: {entry.status}</span>
        )}
        <span>ingested by: {ingesterEmail || entry.source_author || "(unknown)"}</span>
        {entry.created_at && (
          <span>{new Date(entry.created_at).toLocaleString()}</span>
        )}
      </div>

      {entry.readme && (
        <div>
          <button
            type="button"
            onClick={() => setShowReadme((v) => !v)}
            className="text-xs text-text-secondary hover:text-text-primary underline underline-offset-2"
          >
            {showReadme ? "Hide" : "Show"} README
          </button>
          {showReadme && (
            <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-black/40 border border-white/[0.06] p-3 text-xs text-text-secondary whitespace-pre-wrap font-mono">
              {entry.readme}
            </pre>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        <Button
          onClick={() => act("approve")}
          disabled={state === "pending"}
          className="bg-emerald-500/90 hover:bg-emerald-500 text-white"
        >
          Approve
        </Button>
        <Button
          onClick={() => act("deny")}
          disabled={state === "pending"}
          variant="outline"
          className="border-red-500/40 text-red-400 hover:bg-red-500/10"
        >
          Deny
        </Button>
        {state === "pending" && (
          <span className="text-xs text-text-tertiary">Saving...</span>
        )}
        {state === "error" && (
          <span className="text-xs text-red-400">{errorMsg}</span>
        )}
      </div>
    </div>
  );
}
