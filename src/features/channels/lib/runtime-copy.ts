/**
 * Operator-facing sentences about a runtime, built from the descriptor's own `label` — never a
 * vendor literal, so a new runtime gets correct copy by registering. A missing capability hides the
 * button, never the sentence.
 */

import type { RuntimeDescriptor } from "./runtime-capability";

/** The descriptor's label, or `""` (unknown): each sentence carries its own unnamed form (INVARIANTS §11). */
function named(d: RuntimeDescriptor | null | undefined): string {
  return typeof d?.label === "string" ? d.label.trim() : "";
}

/** Can Dopl drive this runtime's sign-in from inside the app? */
export const canSignIn = (d: RuntimeDescriptor | null | undefined): boolean =>
  !!d?.credential?.interactiveSignIn;

/** The sign-in button label, or `null` where Dopl cannot drive the flow in its own window (Codex). */
export function signInAction(
  d: RuntimeDescriptor | null | undefined
): string | null {
  return canSignIn(d) ? `Sign in to ${named(d) || "the agent runtime"}` : null;
}

/** "This machine cannot run an agent", one short line (INVARIANTS §5). */
export const noRuntimeCopy = (
  d: RuntimeDescriptor | null | undefined
): string => {
  const name = named(d);
  return name ? `No ${name} runtime on this Mac` : "No agent runtime on this Mac";
};

/** The signed-out launch refusal; said even where {@link signInAction} offers no button. */
export const signedOutLaunchCopy = (
  d: RuntimeDescriptor | null | undefined
): string => {
  const name = named(d);
  return name
    ? `Sign in to ${name} to start an agent`
    : "Sign in to your agent runtime to start an agent";
};

/** What a 1:1 composer says while its agent is held on a sign-in. */
export const agentAuthHeldCopy = (
  d: RuntimeDescriptor | null | undefined
): string => {
  const name = named(d);
  return name
    ? `Your agent is waiting for you to sign in to ${name}.`
    : "Your agent is waiting for you to sign in to its runtime.";
};
