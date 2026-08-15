"use client";

/**
 * The "Connect → log in" block: hosted MCP endpoint URL + the Claude Code HTTP
 * command. No API key — the client runs the OAuth dance on first connect and
 * server updates roll out automatically. Rendered in settings + overview.
 * Origin is read client-side to match the live deployment.
 */

import { useEffect, useState } from "react";
import { CopyButton } from "@/shared/ui/copy-button";
import { SECTION_BOX_INSET } from "@/shared/ui/section-box";
import { cn } from "@/shared/lib/utils";
import { buildClaudeCliHttp } from "../snippets";
import { getAppOrigin } from "@/shared/lib/app-origin";

export function RemoteConnect() {
  const [origin, setOrigin] = useState("https://www.usedopl.com");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(getAppOrigin());
  }, []);

  const url = `${origin}/api/mcp`;
  const cli = buildClaudeCliHttp(url);

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
        <Row label="Claude Code" text={cli} />
        <Row label="MCP server URL (Desktop / Claude.ai)" text={url} />
      </div>
    </section>
  );
}

function Row({ label, text }: { label: string; text: string }) {
  return (
    <div className="space-y-1">
      <p className="text-micro font-mono uppercase tracking-wider text-text-muted">
        {label}
      </p>
      <div className="flex items-center gap-2 rounded-lg border border-border-default bg-bg-elevated px-3 py-2">
        <code className="flex-1 truncate font-mono text-small text-text-secondary">
          {text}
        </code>
        <CopyButton text={text} />
      </div>
    </div>
  );
}
