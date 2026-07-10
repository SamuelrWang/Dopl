"use client";

import { useEffect, useState } from "react";
import { Bot, X } from "lucide-react";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import { useMcpConnectionPoll } from "../hooks/use-mcp-connection-poll";
import { McpConnectStep } from "./mcp-connect-step";

const DISMISS_KEY = "dopl:connect-banner-dismissed";
const CONNECTED_KEY = "dopl:connect-banner-connected-seen";

// localStorage can throw (private mode / storage disabled). Degrade to a
// session-only flag rather than crashing the banner.
function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function persistFlag(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // Storage unavailable — the flag stays in-memory for this session.
  }
}

/**
 * Persistent, recoverable "connect your agent" prompt. Shows on every
 * workspace page until the caller has an active MCP token — so skipping
 * the onboarding connect step is no longer a dead end. Dismiss is sticky
 * via localStorage, and once a connection has been seen the banner stops
 * checking entirely (no status fetch for connected/dismissed users; the
 * 3.5s live poll runs only while the banner is visible and waiting).
 */
export function ConnectAgentBanner() {
  const [dismissed, setDismissed] = useState(false);
  // Until the mount-read resolves, treat as skipped so SSR/first paint
  // never fetches or flashes the banner.
  const [skip, setSkip] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const wasDismissed = readFlag(DISMISS_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(wasDismissed);
    setSkip(wasDismissed || readFlag(CONNECTED_KEY));
  }, []);

  const statusQuery = useApiQuery<{ connected?: boolean }>(
    "/api/onboarding/mcp-status",
    { enabled: !skip }
  );
  const loaded = skip || statusQuery.data !== undefined;
  const connected = !!statusQuery.data?.connected;

  // Live detection so the banner + modal auto-resolve once the agent
  // connects, without the user reloading.
  const liveConnected = useMcpConnectionPoll(
    loaded && !skip && !connected && !dismissed
  );
  const isConnected = connected || liveConnected;

  // Once connected, stop checking on every future mount.
  useEffect(() => {
    if (isConnected) persistFlag(CONNECTED_KEY);
  }, [isConnected]);

  function dismiss() {
    setDismissed(true);
    persistFlag(DISMISS_KEY);
  }

  if (skip || !loaded || isConnected) return null;
  if (dismissed && !open) return null;

  return (
    <>
      {!dismissed && (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border-default bg-bg-elevated px-4 py-2.5 shadow-lg">
          <Bot size={15} className="text-link" />
          <span className="text-lead text-text-secondary">
            Connect your AI agent to build out your workspace
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full bg-surface-cta px-3 py-1 text-small font-medium text-text-on-cta transition-opacity hover:opacity-90 cursor-pointer"
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
            className="w-full max-w-lg rounded-[14px] bg-white p-7 shadow-2xl"
            style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
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
