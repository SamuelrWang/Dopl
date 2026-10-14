"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  canCancelRuntimeSignIn,
  canSignInToRuntime,
  cancelRuntimeSignIn,
  signInToRuntime,
  useRuntimeCredentials,
} from "@/features/channels/components/runtime-signin";

/**
 * Step 3, "Bring Your Agent" (Samuel 2026-10-13): sign Dopl's own runtimes
 * in — Claude (Claude Code), ChatGPT (Codex), Muse and Grok (real runtimes
 * since the runtime scaffold; wired 2026-10-14) — with the SAME bridge flow
 * the channel surfaces use (`channels/components/runtime-signin.ts`): the
 * desktop runs the provider's sign-in, and no credential crosses the bridge.
 * Each button reflects the runtime's live state from `runtimeAuth.status`.
 *
 * Optional, so Continue is NOT gated: an agent can be signed in later from
 * any launch, and gating would strand a user whose provider sign-in fails.
 *
 * The flip to "Signed in" is main's status PUSH (`useRuntimeCredentials` follows `onStatus`), not the
 * click's answer, and main brings Dopl to the front on success (`runtime-credentials.js › bringToFront`).
 * A closed browser tab sends nothing back, so "Signing in…" is itself the Cancel; an untouched flow ends at
 * main's 5-minute timeout as a failed sign-in.
 *
 * `previewOnly` never touches the bridge: a click flips a fake "Signed in".
 */

/** The runtime registry's ids (`dopl-desktop-app/main/runtime/*`). */
type RuntimeId = "claude" | "codex" | "muse" | "grok";
const RUNTIMES: readonly RuntimeId[] = ["claude", "codex", "muse", "grok"];
const DOUBLE_CLICK_MS = 600;
/** What a failure message calls each runtime. */
const LABEL: Record<RuntimeId, string> = { claude: "Claude", codex: "ChatGPT", muse: "Muse", grok: "Grok" };

export function BringAgentStep({
  previewOnly,
  claudeLogo,
  chatgptLogo,
  museLogo,
  grokLogo,
  onContinue,
}: {
  previewOnly: boolean;
  /** Inlined Claude mark from the mount (shared files cannot import images). */
  claudeLogo?: string;
  /** Inlined ChatGPT mark, same rule. */
  chatgptLogo?: string;
  /** Inlined Meta Muse mark, same rule. */
  museLogo?: string;
  /** Inlined Grok mark, same rule; absent → text-only button. */
  grokLogo?: string;
  onContinue: () => void;
}) {
  const live = useRuntimeCredentials();
  const [can] = useState(() => !previewOnly && canSignInToRuntime());
  const [fake, setFake] = useState<Record<RuntimeId, boolean>>({
    claude: false,
    codex: false,
    muse: false,
    grok: false,
  });
  const [busy, setBusy] = useState<RuntimeId | null>(null);
  const [failed, setFailed] = useState<RuntimeId | null>(null);
  // Same-tick guard: a double click must not start (or, for Codex, supersede) a second flow.
  const inFlight = useRef(false);
  // A cancelled flow answers `{ ok: false }` too; that is not a failed sign-in.
  const cancelled = useRef(false);
  // A double click's second press lands on "Signing in…": inside this window it is not a Cancel.
  const startedAt = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const signedIn = (id: RuntimeId) =>
    previewOnly ? fake[id] : live.find((r) => r.runtimeId === id)?.state === "connected";

  // Busy from this click, or from main's row (a flow started before this step mounted).
  const busyFor = (id: RuntimeId) =>
    !previewOnly && (busy === id || live.find((r) => r.runtimeId === id)?.state === "signing-in");
  const anyBusy = busy !== null || RUNTIMES.some(busyFor);

  const signIn = (id: RuntimeId) => {
    if (previewOnly) {
      setFake((f) => ({ ...f, [id]: !f[id] }));
      return;
    }
    if (!can) return;
    if (busyFor(id)) {
      if (Date.now() - startedAt.current < DOUBLE_CLICK_MS) return;
      cancelled.current = true;
      cancelRuntimeSignIn(id);
      return;
    }
    if (inFlight.current || anyBusy) return;
    inFlight.current = true;
    cancelled.current = false;
    startedAt.current = Date.now();
    setBusy(id);
    setFailed(null);
    void signInToRuntime(id).then((res) => {
      inFlight.current = false;
      if (!mounted.current) return;
      setBusy(null);
      if (!res.ok && !cancelled.current) setFailed(id);
    });
  };

  const button = (id: RuntimeId, icon: ReactNode) => {
    const label = LABEL[id];
    const on = signedIn(id);
    const mine = busyFor(id);
    const cancellable = mine && canCancelRuntimeSignIn();
    return (
      <button
        type="button"
        onClick={() => signIn(id)}
        disabled={
          (!previewOnly && !can) ||
          (anyBusy && !cancellable) ||
          (on && !previewOnly)
        }
        aria-busy={mine}
        className="auth-btn-3d-light flex h-12 w-full cursor-pointer items-center gap-3 rounded-[10px] px-4 text-[14px] font-semibold text-[#181818] disabled:cursor-default"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
        <span className="flex-1 text-left">
          {mine ? "Signing in…" : on ? `Signed in to ${label}` : `Sign in to ${label}`}
        </span>
        {cancellable && <span className="text-[12px] font-medium text-[#9a9a9a]">Cancel</span>}
        {on && !mine && <CheckGlyph />}
      </button>
    );
  };

  return (
    <div className="w-full">
      <h2 className="text-[26px] font-bold leading-tight tracking-[-0.5px] text-[#181818]">
        Bring Your Agent
      </h2>

      <div className="mt-7 space-y-3">
        {button("claude", <Mark src={claudeLogo} />)}
        {button("codex", <Mark src={chatgptLogo} />)}
        {button("muse", <Mark src={museLogo} />)}
        {button("grok", <Mark src={grokLogo} />)}
      </div>
      {failed && (
        <p role="status" className="mt-2 text-[12px] leading-relaxed text-[#C0392B]">
          {LABEL[failed]} sign-in didn&apos;t finish. Try again.
        </p>
      )}
      {!previewOnly && !can && (
        <p className="mt-2 text-[12px] leading-relaxed text-[#9a9a9a]">
          Sign-in runs in the Dopl desktop app.
        </p>
      )}

      <div className="mt-8 flex justify-end">
        <button
          type="button"
          onClick={onContinue}
          className="auth-btn-3d cursor-pointer rounded-[10px] px-8 py-2.5 text-[14px] font-semibold text-white"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

/** Green = signed in: the severity ramp's `success`, the colour "connected" reads in elsewhere. */
function CheckGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden className="text-success">
      <path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/** A provider mark from the mount, or nothing (the label stands alone). */
function Mark({ src }: { src?: string }) {
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element -- shared file, also compiled by Vite
  return <img src={src} alt="" draggable={false} className="h-5 w-5" />;
}
