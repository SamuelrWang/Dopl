"use client";

/**
 * One bar per runtime Dopl signs in from the app: its name, its status and, where a sign-in would help,
 * the control. Live from main's status push; absent (nothing rendered) without the bridge.
 */

import { cn } from "@/shared/lib/utils";
import { OpenScaleButton } from "@/shared/ui/open-scale-button";
import type { RuntimeCredentialStatus } from "@/shared/lib/spa-bridge";
import { SIGN_IN_BUSY } from "../lib/runtime-copy";
import {
  cancelRuntimeSignIn,
  canCancelRuntimeSignIn,
  signInFullToRuntime,
  signInToRuntime,
  useRuntimeCredentials,
} from "./runtime-signin";

const FULL_LABEL = "Enable Chrome & connectors";

const STATUS: Record<RuntimeCredentialStatus["state"], { text: string; tone: string } | null> = {
  connected: { text: "Connected", tone: "text-success" },
  "not-connected": { text: "Not connected", tone: "text-text-muted" },
  expired: { text: "Sign-in expired", tone: "text-danger" },
  "signing-in": null,
};

/** `rows`: hairline rows for a settings card (the profile popup); `bars`: framed bars (onboarding). */
export function RuntimeCredentialBars({
  className,
  variant = "bars",
}: {
  className?: string;
  variant?: "bars" | "rows";
}) {
  const runtimes = useRuntimeCredentials();
  const canCancel = canCancelRuntimeSignIn();
  if (!runtimes.length) return null;
  const rows = variant === "rows";
  return (
    <ul className={cn(rows ? "divide-y divide-border-subtle" : "space-y-2", className)}>
      {runtimes.map((r) => {
        const status = STATUS[r.state];
        const busy = r.state === "signing-in";
        return (
          <li
            key={r.runtimeId}
            className={cn(
              "flex items-center justify-between gap-3",
              rows ? "py-2.5" : "rounded-lg border border-border-default bg-bg-elevated px-3 py-2"
            )}
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-body font-medium text-text-primary">{r.label}</span>
              {r.notice && <span className="text-caption text-text-secondary">{r.notice}</span>}
            </span>
            <span className="flex items-center gap-3">
              {status && <span className={cn("text-caption", status.tone)}>{status.text}</span>}
              {r.state !== "connected" && (
                <OpenScaleButton
                  onClick={() => void signInToRuntime(r.runtimeId)}
                  disabled={busy}
                  aria-busy={busy}
                  aria-label={busy ? undefined : `Sign in to ${r.label}`}
                  className="disabled:opacity-60"
                >
                  {busy ? SIGN_IN_BUSY : "Sign in"}
                </OpenScaleButton>
              )}
              {r.state === "connected" && r.full === "on" && (
                <span className="text-caption text-success">Chrome & connectors on</span>
              )}
              {r.state === "connected" && (r.full === "off" || r.full === "signing-in") && (
                <OpenScaleButton
                  onClick={() => void signInFullToRuntime(r.runtimeId)}
                  disabled={r.full === "signing-in"}
                  aria-busy={r.full === "signing-in"}
                  className="disabled:opacity-60"
                >
                  {r.full === "signing-in" ? SIGN_IN_BUSY : FULL_LABEL}
                </OpenScaleButton>
              )}
              {canCancel && (busy || r.full === "signing-in") && (
                <OpenScaleButton
                  onClick={() => cancelRuntimeSignIn(r.runtimeId)}
                  aria-label={`Cancel ${r.label} sign-in`}
                >
                  Cancel
                </OpenScaleButton>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
