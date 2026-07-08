"use client";

/**
 * RemoteConnect — the "Connect → log in" block. Surfaces the hosted MCP
 * endpoint URL + the Claude Code HTTP command. No API key: the client runs the
 * OAuth dance (browser sign-in) on first connect, and server updates roll out
 * automatically (nothing installed locally).
 *
 * Rendered in the settings + overview surfaces and the canvas connection panel.
 * Origin is read client-side to match the live deployment.
 */

import { useEffect, useState } from "react";
import { Copy, Check } from "lucide-react";
import { SECTION_BOX_INSET } from "@/shared/ui/section-box";
import { cn } from "@/shared/lib/utils";
import { buildClaudeCliHttp } from "../snippets";

export function RemoteConnect() {
  const [origin, setOrigin] = useState("https://www.usedopl.com");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  const url = `${origin}/api/mcp`;
  const cli = buildClaudeCliHttp(url);
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string, id: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <section className="w-full overflow-hidden rounded-[14px] border border-border-strong">
      <div className="flex items-center bg-card-surface-subtle px-4 py-1.5">
        <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
          Connect &amp; log in
        </span>
      </div>
      <div className={cn(SECTION_BOX_INSET, "space-y-3 p-4")}>
        <p className="text-caption leading-snug text-text-secondary">
          Add this URL in your MCP client (Claude Code/Desktop, Cursor, or
          Claude.ai&rsquo;s &ldquo;Add custom connector&rdquo;). A browser opens
          once to sign in to Dopl — no API key to copy, and server updates roll
          out automatically.
        </p>
        <Row
          label="Claude Code"
          text={cli}
          id="http-cli"
          copied={copied}
          onCopy={copy}
        />
        <Row
          label="MCP server URL (Desktop / Claude.ai)"
          text={url}
          id="http-url"
          copied={copied}
          onCopy={copy}
        />
      </div>
    </section>
  );
}

function Row({
  label,
  text,
  id,
  copied,
  onCopy,
}: {
  label: string;
  text: string;
  id: string;
  copied: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-micro font-mono uppercase tracking-wider text-text-muted">
        {label}
      </p>
      <div className="flex items-center gap-2 rounded-lg border border-border-default bg-bg-elevated px-3 py-2">
        <code className="flex-1 truncate font-mono text-small text-text-secondary">
          {text}
        </code>
        <button
          type="button"
          onClick={() => onCopy(text, id)}
          className="shrink-0 text-text-muted transition-colors hover:text-text-secondary"
          title="Copy"
        >
          {copied === id ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}
