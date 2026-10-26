// STAGING COPY of src/features/channels/components/runtime-credential-bars.tsx (tree of 2026-10-22). Only import paths differ from the source (data hooks and
// desktop libs → src/features/settings-staging/stubs). See src/features/settings-staging/PORTING.md.
"use client";

/**
 * One row per runtime Dopl signs in from the app: its name, its status and, where a sign-in would
 * help, the control. Live from main's status push; absent (nothing rendered) without the bridge.
 */

import { cn } from "@/shared/lib/utils";
import type { RuntimeCredentialStatus } from "@/shared/lib/spa-bridge";
import { SMALL_PILL_BUTTON } from "@/shared/ui/small-action-button";
import { StatusPill, type StatusTone } from "@/shared/ui/status-pill";
import { SIGN_IN_BUSY } from "@/features/channels/lib/runtime-copy";
import {
  cancelRuntimeSignIn,
  canCancelRuntimeSignIn,
  signInFullToRuntime,
  signInToRuntime,
  useRuntimeCredentials,
} from "@/features/settings-staging/stubs/runtime-signin";

const FULL_LABEL = "Enable Chrome & connectors";

const STATUS: Record<RuntimeCredentialStatus["state"], { text: string; tone: StatusTone } | null> = {
  connected: { text: "Connected", tone: "live" },
  "not-connected": { text: "Not connected", tone: "neutral" },
  expired: { text: "Sign-in expired", tone: "attention" },
  "signing-in": null,
};

/** Hairline rows for a settings card (the profile popup's Agents pane). */
export function RuntimeCredentialBars({ className }: { className?: string }) {
  const runtimes = useRuntimeCredentials();
  const canCancel = canCancelRuntimeSignIn();
  if (!runtimes.length) return null;
  return (
    <ul className={cn("divide-y divide-border-default", className)}>
      {runtimes.map((r) => {
        const status = STATUS[r.state];
        const busy = r.state === "signing-in";
        return (
          <li key={r.runtimeId} className="flex items-center justify-between gap-3 py-2.5">
            <span className="flex min-w-0 flex-col">
              <span className="text-body font-medium text-text-primary">{r.label}</span>
              {r.notice && <span className="text-caption text-text-secondary">{r.notice}</span>}
            </span>
            <span className="flex items-center gap-3">
              {status && (
                <StatusPill tone={status.tone} dot={status.tone === "live"}>
                  {status.text}
                </StatusPill>
              )}
              {r.state !== "connected" && (
                <button
                  type="button"
                  onClick={() => void signInToRuntime(r.runtimeId)}
                  disabled={busy}
                  aria-busy={busy}
                  aria-label={busy ? undefined : `Sign in to ${r.label}`}
                  className={SMALL_PILL_BUTTON}
                >
                  {busy ? SIGN_IN_BUSY : "Sign in"}
                </button>
              )}
              {r.state === "connected" && r.full === "on" && (
                <StatusPill>Chrome & connectors on</StatusPill>
              )}
              {r.state === "connected" && (r.full === "off" || r.full === "signing-in") && (
                <button
                  type="button"
                  onClick={() => void signInFullToRuntime(r.runtimeId)}
                  disabled={r.full === "signing-in"}
                  aria-busy={r.full === "signing-in"}
                  className={SMALL_PILL_BUTTON}
                >
                  {r.full === "signing-in" ? SIGN_IN_BUSY : FULL_LABEL}
                </button>
              )}
              {canCancel && (busy || r.full === "signing-in") && (
                <button
                  type="button"
                  onClick={() => cancelRuntimeSignIn(r.runtimeId)}
                  aria-label={`Cancel ${r.label} sign-in`}
                  className={SMALL_PILL_BUTTON}
                >
                  Cancel
                </button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
