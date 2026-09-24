"use client";

/**
 * One bar per runtime Dopl signs in from the app: its name, its status and, where a sign-in would help,
 * the control. Live from main's status push; absent (nothing rendered) without the bridge.
 */

import { cn } from "@/shared/lib/utils";
import { OpenScaleButton } from "@/shared/ui/open-scale-button";
import type { RuntimeCredentialStatus } from "@/shared/lib/spa-bridge";
import { SIGN_IN_BUSY } from "../lib/runtime-copy";
import { signInToRuntime, useRuntimeCredentials } from "./runtime-signin";

const STATUS: Record<RuntimeCredentialStatus["state"], { text: string; tone: string } | null> = {
  connected: { text: "Connected", tone: "text-success" },
  "not-connected": { text: "Not connected", tone: "text-text-muted" },
  expired: { text: "Sign-in expired", tone: "text-danger" },
  "signing-in": null,
};

export function RuntimeCredentialBars({ className }: { className?: string }) {
  const runtimes = useRuntimeCredentials();
  if (!runtimes.length) return null;
  return (
    <ul className={cn("space-y-2", className)}>
      {runtimes.map((r) => {
        const status = STATUS[r.state];
        const busy = r.state === "signing-in";
        return (
          <li
            key={r.runtimeId}
            className="flex items-center justify-between gap-3 rounded-lg border border-border-default bg-bg-elevated px-3 py-2"
          >
            <span className="text-body font-medium text-text-primary">{r.label}</span>
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
            </span>
          </li>
        );
      })}
    </ul>
  );
}
