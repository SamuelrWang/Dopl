/**
 * RUNTIME-OWNED COPY — every operator-facing sentence about a RUNTIME, built
 * from that runtime's own descriptor instead of from one vendor's name
 * (2026-09-21, U10). The web side's mirror of
 * `dopl-desktop-app/main/runtime/runtime-copy.js`.
 *
 * ⚠ WHY IT EXISTS. The Agents tab said `No Claude runtime on this Mac` and
 * `Sign in to Claude to start an agent` for EVERY runtime. Main's refusal words
 * are vendor-neutral by design (`no-sdk` means "this machine has no agent
 * runtime" on every runtime — `session-launch.js` states that in as many words);
 * the Claude was invented HERE, in the copy map. So a signed-out Codex told the
 * operator to fix a Claude credential the session does not use, and a machine
 * running Codex perfectly well was told it had no runtime.
 *
 * ⚠ NO PER-RUNTIME BRANCH AND NO VENDOR LITERAL. Every sentence is built from
 * `descriptor.label`, which is the adapter's own word for itself and the one
 * field `main/runtime/contract.js › descriptorProblems` refuses to register an
 * adapter without. A FOURTH runtime gets correct copy by registering, not by
 * someone remembering to add an arm here — `runtime-refusals.test.tsx` scans this
 * module's exports across all three shipped descriptors for exactly that.
 *
 * ⚠ THE ACTION IS A CAPABILITY, NOT A STRING. `credential.interactiveSignIn` is
 * `true` only where Dopl can actually drive a sign-in; the others answer `null`,
 * and the rule for an absent capability is HIDE, NEVER GRAY
 * (`runtime-capability.ts`'s header). So {@link signInAction} answers `null`
 * there and the surface renders the SENTENCE with no button — what is hidden is
 * the affordance, never the fact.
 *
 * ⚠ NO HOOK, NO BRIDGE, NO REACT — the rule `runtime-capability.ts` and
 * `permission-modes.ts` both state (INVARIANTS §1: one file, one reason to
 * change). The ONE reason this file changes is that
 * `main/runtime/runtime-copy.js` changed.
 *
 * ⚠ IT IS NOT A SECOND AUTHORITY. Every sentence is derived from the descriptor
 * the desktop handed over, which `contract.js › sealAdapter` deep-froze; this
 * module decides nothing.
 */

import type { RuntimeDescriptor } from "./runtime-capability";

/**
 * The descriptor's own label, or `""` when there is none.
 *
 * ⚠ THE EMPTY STRING IS THE **UNKNOWN** ANSWER AND EVERY SENTENCE BELOW BRANCHES
 * ON IT (INVARIANTS §11: unknown is not empty). A descriptor nobody sent is the
 * plain-browser / older-desktop case; inventing a name there is the defect this
 * module removes, and so is grafting a placeholder into a sentence written for a
 * real one ("No the agent runtime runtime on this Mac"). Each sentence carries
 * its own unnamed form, worded to read.
 */
function named(d: RuntimeDescriptor | null | undefined): string {
  return typeof d?.label === "string" ? d.label.trim() : "";
}

/** Can Dopl drive this runtime's sign-in from inside the app? */
export const canSignIn = (d: RuntimeDescriptor | null | undefined): boolean =>
  !!d?.credential?.interactiveSignIn;

/**
 * The SIGN-IN ACTION's label, or `null` when this runtime has no in-app flow.
 *
 * ⚠ `null` IS THE POINT. Codex declares `interactiveSignIn: null` because
 * `codex login` drives an OAuth flow Dopl cannot complete inside its own window,
 * so a button there would be a control that lies. The sentence is still said.
 */
export function signInAction(
  d: RuntimeDescriptor | null | undefined
): string | null {
  return canSignIn(d) ? `Sign in to ${named(d) || "the agent runtime"}` : null;
}

/** "This machine cannot run an agent at all", in the selected runtime's words.
 *  ⚠ ONE SHORT LINE, per the minimal-copy ruling (INVARIANTS §5). */
export const noRuntimeCopy = (
  d: RuntimeDescriptor | null | undefined
): string => {
  const name = named(d);
  return name ? `No ${name} runtime on this Mac` : "No agent runtime on this Mac";
};

/** The signed-out fact as a launch refusal, beside the button just pressed.
 *  ⚠ THE SENTENCE DOES NOT DEPEND ON THERE BEING A BUTTON: {@link signInAction}
 *  is `null` on a runtime with no in-app flow, and the operator still has to be
 *  told which credential is missing. The remedy's ABSENCE never removes the
 *  statement — that is the difference between HIDING a control and hiding a fact. */
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
