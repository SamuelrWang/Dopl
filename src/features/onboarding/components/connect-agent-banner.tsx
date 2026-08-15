"use client";

import { useEffect, useState } from "react";
import { Bot, X } from "lucide-react";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import { useMcpConnectionPoll } from "../hooks/use-mcp-connection-poll";
import { McpConnectStep } from "./mcp-connect-step";

const DISMISS_KEY = "dopl:connect-banner-dismissed";
const CONNECTED_KEY = "dopl:connect-banner-connected-seen";

// localStorage throws in private mode / storage-disabled — degrade to a
// session-only flag rather than crash the banner.
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
    // Storage unavailable — flag stays in-memory this session.
  }
}

/**
 * Recoverable "connect your agent" prompt — shows on every workspace page
 * until an MCP token exists, so skipping onboarding's connect step is not a
 * dead end. Dismiss sticky via localStorage. ⚠ Cost gate: no status fetch for
 * connected/dismissed users; 3.5s poll runs only while visible and waiting.
 */
export function ConnectAgentBanner() {
  const [dismissed, setDismissed] = useState(false);
  // Skipped until mount-read resolves: SSR/first paint must not fetch or flash.
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
  // Fail-open: failed status fetch still shows banner; live poll retries.
  const loaded = skip || statusQuery.data !== undefined || statusQuery.isError;
  const connected = !!statusQuery.data?.connected;

  // Auto-resolve banner + modal on connect, without a reload.
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
