"use client";

import { useState } from "react";
import { ChevronDown, Loader2, Plug } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { CopyButton } from "@/shared/ui/copy-button";
import { usePlaygroundSession } from "../session";

/**
 * The wiring strip above the panes: starts a guest session, then hands the
 * visitor the one URL (and per-client one-liners) that connects their agent.
 * Row/label recipes mirror the real connect surface —
 * `features/mcp-connect/components/remote-connect.tsx` — and the buttons
 * compose the kit faces with the app's radii (`btn-light` + `rounded-md`,
 * `auth-btn-3d` + `rounded-full`), since the kit classes deliberately carry
 * no radius of their own.
 */
export function ConnectStrip() {
  const { session, starting, error, start } = usePlaygroundSession();
  const [open, setOpen] = useState(false);

  const origin =
    typeof window === "undefined" ? "https://www.usedopl.com" : window.location.origin;
  const mcpUrl = session
    ? `${origin}/api/playground/mcp/${session.token}`
    : null;

  return (
    <div className="border-b border-border-subtle bg-card-surface-subtle px-4 py-2">
      <div className="flex h-8 items-center gap-3">
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            session ? "bg-success" : "bg-text-disabled"
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-small text-text-secondary">
          {session
            ? `Live workspace — connect your agent and watch it work. Session ends ${formatExpiry(session.expiresAt)}.`
            : error ??
              "This is a demo of a real Dopl workspace. Start a session to let your agent read and write it — no account needed."}
        </span>
        {session ? (
          <button
            type="button"
            className="btn-light flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-small font-medium text-text-primary"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            <Plug size={13} strokeWidth={2} aria-hidden />
            Connect your agent
            <ChevronDown
              size={13}
              strokeWidth={2}
              aria-hidden
              className={cn("transition-transform", open && "rotate-180")}
            />
          </button>
        ) : (
          <button
            type="button"
            className="auth-btn-3d flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-4 text-small font-semibold text-white"
            onClick={start}
            disabled={starting}
          >
            {starting && (
              <Loader2 size={13} strokeWidth={2} className="animate-spin" aria-hidden />
            )}
            {starting ? "Starting…" : "Start playground"}
          </button>
        )}
      </div>

      {session && open && mcpUrl && (
        <div className="mt-2 space-y-3 pb-2">
          <ConnectRow
            label="Claude — Settings → Connectors → Add custom connector"
            text={mcpUrl}
          />
          <ConnectRow
            label="Claude Code"
            text={`claude mcp add --transport http dopl-playground ${mcpUrl}`}
          />
          <ConnectRow
            label="Codex — CLI, IDE extension & ChatGPT desktop app"
            text={`codex mcp add dopl-playground --url ${mcpUrl}`}
          />
          <div className="flex items-center gap-2">
            <span className="w-56 shrink-0 truncate text-micro font-mono uppercase tracking-wider text-text-muted">
              Cursor
            </span>
            <a
              href={cursorInstallUrl(mcpUrl)}
              className="btn-light flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-small font-medium text-text-primary"
            >
              Add to Cursor
            </a>
            <span className="truncate text-caption text-text-muted">
              one click — opens Cursor with this workspace preconfigured
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Cursor's official one-click install link (cursor.com/docs/context/mcp/
 * install-links, https variant): base64 of the mcp.json server body. Built at
 * click-render time because the playground URL carries the per-session token.
 */
function cursorInstallUrl(mcpUrl: string): string {
  const config = btoa(JSON.stringify({ url: mcpUrl }));
  return `https://cursor.com/en/install-mcp?name=dopl-playground&config=${encodeURIComponent(config)}`;
}

/** Same row recipe as `remote-connect.tsx › Row`. */
function ConnectRow({ label, text }: { label: string; text: string }) {
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

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "soon";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
