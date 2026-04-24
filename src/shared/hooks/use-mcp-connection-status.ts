"use client";

/**
 * useMcpConnectionStatus — shared polling hook for the onboarding flows.
 *
 * Polls GET /api/user/mcp-status every 3s while `enabled` is true. Fires
 * `onConnected` exactly once when the server first reports connected.
 *
 * Consolidates the identical polling loops previously duplicated in:
 *   - src/app/welcome/welcome-mcp-step.tsx
 *   - src/features/onboarding/components/mcp-connect-step.tsx
 *
 * The hook does NOT delay the onConnected callback — callers control
 * the "show success state for N ms before advancing" behavior by
 * wrapping onConnected in their own setTimeout.
 */
import { useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 3000;

export function useMcpConnectionStatus({
  enabled,
  onConnected,
}: {
  enabled: boolean;
  onConnected: () => void;
}): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  // Ref so we never call onConnected twice even if React re-renders mid-poll.
  const connectedRef = useRef(false);
  // Ref so the effect doesn't re-subscribe whenever the caller's
  // onConnected changes identity (which it will on every render).
  const onConnectedRef = useRef(onConnected);
  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  useEffect(() => {
    if (!enabled || connectedRef.current) return;
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function check() {
      try {
        const res = await fetch("/api/user/mcp-status");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data.connected && !connectedRef.current) {
          connectedRef.current = true;
          if (intervalId) clearInterval(intervalId);
          if (!cancelled) {
            setConnected(true);
            onConnectedRef.current();
          }
        }
      } catch {
        // Polling is best-effort.
      }
    }

    check();
    intervalId = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [enabled]);

  return { connected };
}
