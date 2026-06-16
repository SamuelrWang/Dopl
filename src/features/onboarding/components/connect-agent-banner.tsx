"use client";

import { useEffect, useState } from "react";
import { Bot, X } from "lucide-react";
import { useMcpConnectionPoll } from "../hooks/use-mcp-connection-poll";
import { McpConnectStep } from "./mcp-connect-step";

const DISMISS_KEY = "dopl:connect-banner-dismissed";

// localStorage can throw (private mode / storage disabled). Degrade to a
// session-only flag rather than crashing the banner.
function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function persistDismissed(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // Storage unavailable — dismissal stays in-memory for this session.
  }
}

/**
 * Persistent, recoverable "connect your agent" prompt. Shows on every
 * workspace page until the caller has an active MCP token — so skipping
 * the onboarding connect step is no longer a dead end. Dismiss is sticky
 * via localStorage (clears on storage reset / new device); the banner
 * also auto-resolves the moment an agent finishes the OAuth dance.
 *
 * Reads only the existing /api/onboarding/mcp-status endpoint — no new
 * server state, nothing routed through the canvas store (ENGINEERING §7).
 */
export function ConnectAgentBanner() {
  const [loaded, setLoaded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // localStorage is client-only, so the dismissed flag can't seed the
    // initializer without breaking SSR — read it once on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(readDismissed());
    let cancelled = false;
    fetch("/api/onboarding/mcp-status", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { connected?: boolean } | null) => {
        if (!cancelled && body) setConnected(!!body.connected);
      })
      .catch(() => {
        // Transient failure — the poll below retries.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live detection so the banner + modal auto-resolve once the agent
  // connects, without the user reloading.
  const liveConnected = useMcpConnectionPoll(loaded && !connected && !dismissed);
  const isConnected = connected || liveConnected;

  function dismiss() {
    setDismissed(true);
    persistDismissed();
  }

  if (!loaded || isConnected) return null;
  if (dismissed && !open) return null;

  return (
    <>
      {!dismissed && (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border-default bg-bg-elevated px-4 py-2.5 shadow-lg">
          <Bot size={15} className="text-link" />
          <span className="text-[13px] text-text-secondary">
            Connect your AI agent to build out your workspace
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full bg-surface-cta px-3 py-1 text-[12px] font-medium text-text-on-cta transition-opacity hover:opacity-90 cursor-pointer"
          >
            Connect
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="text-text-secondary/60 transition-colors hover:text-text-primary cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-bg-overlay p-7 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <McpConnectStep
              connected={isConnected}
              finishing={false}
              onSkip={() => setOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}
