"use client";

/**
 * The in-app sign-in control for one runtime: the runtime's own label, a busy state, and a plain line
 * when the sign-in did not take. Absent (never grayed) without the bridge op, or where the runtime's
 * descriptor declares no in-app flow.
 */

import { useEffect, useRef, useState } from "react";
import { TAB_ACTION } from "./bits";
import { canSignInToRuntime, signInToRuntime } from "./runtime-signin";
import type { RuntimeDescriptor } from "../lib/runtime-capability";
import { canSignIn, SIGN_IN_BUSY, signInAction, signInFailedCopy } from "../lib/runtime-copy";

/** Read once after mount via lazy state, so server and first client render agree. */
export function useCanSignInToRuntime(): boolean {
  const [can] = useState(() => canSignInToRuntime());
  return can;
}

export function RuntimeSignInButton({
  runtime,
  runtimeId,
  onSignedIn,
}: {
  /** Whose flow and label. `null` (not reported yet) leaves the bridge op to decide alone. */
  runtime: RuntimeDescriptor | null | undefined;
  /** Sent when `runtime` is null — an agent's stamped runtime; absent = the default runtime. */
  runtimeId?: string;
  /** Runs only on `ok`; main has already released that runtime's held agents by then. */
  onSignedIn?: () => void;
}) {
  const can = useCanSignInToRuntime();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // A sign-in can outlive the surface that started it (a dialog closed mid-flow).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (!can || (runtime != null && !canSignIn(runtime))) return null;

  const signIn = () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    void signInToRuntime(runtime?.id ?? runtimeId).then((res) => {
      if (!mounted.current) return;
      setBusy(false);
      if (res.ok) onSignedIn?.();
      else setFailed(true);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        aria-busy={busy}
        className={TAB_ACTION}
      >
        {/* `signInAction` is null exactly where `canSignIn` is false; the fallback is the unnamed lane. */}
        {busy ? SIGN_IN_BUSY : (signInAction(runtime) ?? "Sign in")}
      </button>
      {failed && (
        <p role="status" className="text-caption text-danger">
          {signInFailedCopy(runtime)}
        </p>
      )}
    </>
  );
}
