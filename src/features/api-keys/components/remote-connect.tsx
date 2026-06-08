"use client";

/**
 * RemoteConnect — the recommended "Connect → log in" block. Surfaces the
 * hosted MCP endpoint URL + the Claude Code HTTP command. No API key: the
 * client runs the OAuth dance (browser sign-in) on first connect, and server
 * updates roll out automatically (nothing installed locally).
 *
 * Rendered at the top of both the settings ConnectionSetup and the overview
 * ConnectAppSection. Origin is read client-side to match the live deployment.
 */

import { useEffect, useState } from "react";
import { Copy, Check } from "lucide-react";
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
    <div className="rounded-[4px] border border-violet-400/30 bg-violet-500/[0.05] p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-text-primary">
          Recommended — connect &amp; log in
        </p>
        <p className="text-[11px] text-text-tertiary leading-snug mt-0.5">
          Add this URL in your MCP client (Claude Code/Desktop, Cursor, or
          Claude.ai&rsquo;s &ldquo;Add custom connector&rdquo;). A browser opens
          once to sign in to Dopl — no API key to copy, and server updates roll
          out automatically.
        </p>
      </div>
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
      <p className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
        {label}
      </p>
      <div className="flex items-center gap-2 rounded-[3px] border border-border-default bg-bg-inset px-3 py-2">
        <code className="flex-1 truncate font-mono text-[12px] text-text-secondary">
          {text}
        </code>
        <button
          type="button"
          onClick={() => onCopy(text, id)}
          className="shrink-0 text-text-muted hover:text-text-secondary transition-colors"
          title="Copy"
        >
          {copied === id ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}
