"use client";

/**
 * SIGN THIS MAC IN TO CLAUDE CODE — the ONE entry into the auth recovery flow
 * (2026-08-25).
 *
 * ⚠ IT IS NOT IN `agents-controls.ts`, AND THE SEAM IS REAL RATHER THAN THE LINE
 * COUNT THAT FORCED THE QUESTION (that file sat at 465 and this landed it on
 * exactly 500 — a file at the cap stops being correctable, not merely growable).
 * Every op there is a COMMAND ADDRESSED TO ONE AGENT: it takes `(channelId,
 * taskId, agentId)`, resolves against main's own session registry, and moves that
 * agent. This takes NOTHING and moves the MACHINE — the Claude Code credential
 * this Mac holds, which every agent on it rides and none of them owns. Filing it
 * beside `pause` would have made the third coordinate look optional there.
 *
 * ⚠ THE CREDENTIAL A SESSION RUNS ON IS THE THIRD ONE. Operators conflate their
 * Dopl login, the Claude app login, and the Claude Code credential held by this
 * Mac (`main/session-auth-detect.js` states the same three). A session rides the
 * third and nothing else, which is why the copy on the surface names it.
 *
 * ⚠ WHAT THIS WIRE FIXED IS AN ABSENCE. `main/session-auth.js` has HELD sessions
 * on a missing credential since Q6, and the composer has said so out loud — but
 * `claude-auth.js › startSignInFlow` and `session-auth.js › resumeAfterSignIn`
 * both shipped with ZERO production callers, so nothing could ever enter the
 * remedy. Re-posting into a held agent was refused with `auth-hold` forever.
 *
 * ⚠ NO CREDENTIAL CROSSES THE BRIDGE IN EITHER DIRECTION, and no Dopl surface has
 * a field that would take one: main opens the OAuth page in the SYSTEM BROWSER
 * and collects the pasted code in its own local window (`main/claude-auth.js`).
 */

import { getSpaBridge } from "@/shared/lib/spa-bridge";

/**
 * Whether this build can sign this Mac in at all.
 *
 * ⚠ IT DETECTS `claude.signIn`, the BRIDGE OP it is about to use — never
 * {@link signInToClaude}, which is an export of this module and is therefore
 * always a function. `typeof` on the wrapper answers true in a plain browser and
 * renders a button that can only refuse; that shipped once in the agent window's
 * composer, and `agents-controls.ts › canMessageAgent` carries the story.
 *
 * ⚠ DO NOT WIDEN IT TO `sessions.message`. Every desktop with the 1:1 composer
 * has that op, so detecting it would paint the button on every build that
 * predates this wire — precisely the set where the banner it sits under is
 * unanswerable.
 */
export function canSignInToClaude(): boolean {
  return typeof getSpaBridge()?.claude?.signIn === "function";
}

/**
 * Run the sign-in, and let the work this Mac was holding run.
 *
 * ⚠ `ok` IS ABOUT THE CREDENTIAL, NOT THE FLOW — true when this Mac can run a
 * session afterwards, whichever tier of the sign-in finished. Main cannot report
 * the flow's own outcome anyway: `startSignInFlow` resolves `undefined` on every
 * path, so a completed sign-in, a declined dialog and its single-flight no-op are
 * indistinguishable, and the answer is RE-PROBED from the credential instead.
 * A declined dialog and a failed sign-in are therefore one answer, deliberately:
 * the caller does the same thing with either (leave the waiting banner standing).
 *
 * ⚠ MAIN HAS ALREADY RESUMED every session it was holding by the time this
 * resolves `ok` (`main/session-auth.js › resumeHeldSessions`) — one sign-in, N
 * releases. There is no second op to call and nothing to re-post.
 *
 * ⚠ THE VERDICT IS RETURNED, NEVER SWALLOWED, on this family's standing rule: a
 * sign-in the operator believes they completed, over an agent that is still held,
 * is the worst outcome this lane has.
 */
export async function signInToClaude(): Promise<{ ok: boolean }> {
  const claude = getSpaBridge()?.claude;
  if (typeof claude?.signIn !== "function") return { ok: false };
  const res = await claude.signIn();
  return { ok: res?.ok === true };
}
