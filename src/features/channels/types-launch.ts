/**
 * LAUNCH-OVER-MCP TYPES — an operator's external agent asking that operator's
 * OWN desktop to start an agent (Samuel's ruling, 2026-08-22).
 *
 * ⚠ SPLIT OUT OF `types.ts` at the 500-line cap; re-exported from there, so no
 * import path changed and there is no second path to a symbol.
 */

/**
 * WHY A DESKTOP SAID NO TO A LAUNCH — **exactly six words, and the closed set is
 * the wire contract both trees code against** (2026-08-22).
 *
 * ⚠ **A KEY, NEVER A SENTENCE.** The readable line is written by the reader
 * (`packages/mcp-server/src/tools/channel-ops-launch.ts`), for the same reason
 * {@link SessionDetailKey} splits that way: prose on the wire is prose that needs
 * a desktop release to reword, and desktop-authored text rendered into an MCP
 * result is text nobody neutralized.
 *
 *  - `cap`             — already at the machine's concurrent-agent ceiling.
 *  - `busy`            — the machine is under load and declined for now.
 *  - `no-sdk`          — no agent runtime available on that machine.
 *  - `auth-hold`       — the desktop is signed out or its credential is held.
 *  - `no-bridge`       — **the operator's launch-over-MCP toggle is OFF.** This
 *                        is Samuel's consent mechanism, so this reason is a
 *                        CHOICE and the render must not read as a fault.
 *  - `no-counterparty` — nothing to work with in that channel.
 *  - `no-template`     — ⚠ THE SEVENTH, 2026-08-22 (agent templates). The
 *                        directive named a TEMPLATE and the operator's machine
 *                        could not resolve it: DELETED, or not visible to the
 *                        OPERATOR even though it was visible to the orchestrator
 *                        that named it. Those are ONE answer on purpose — the
 *                        resolve endpoint is 404-never-403 so the difference is
 *                        not observable, and a render that guessed would rebuild
 *                        the oracle. The next action is to re-check the template
 *                        list as the operator, not to re-issue.
 *
 * ⚠ AN EIGHTH REASON IS A SCHEMA CHANGE IN BOTH TREES, deliberately: the column
 * carries the same CHECK, so an unknown value cannot be stored and cannot reach
 * a render as raw text.
 * ⚠ `no-template` IS FULLY LANDED SINCE 2026-08-23. It was half-landed for a day
 * — this list at seven while the column CHECK was at six — and the note here said
 * so, because a producer shipped in that window would have passed zod and been
 * refused AT REST. Both halves are in now:
 * `20260823140000_channel_launch_directives_template.sql` widens the CHECK
 * (⚠ WRITTEN — applied is a measurement, INVARIANTS §12) in the same wave as the
 * producer, `main/launch-directives.js › spawn`, which resolves the directive's
 * template at CLAIM time under the OPERATOR's credential.
 *
 * ⚠ `template-approval` IS NOT A MEMBER AND MUST NOT BECOME ONE. It is an
 * IPC-only word: the desktop answers it to its OWN renderer when a FOREIGN
 * template's first run on that machine needs one human click. There is no human
 * at the keyboard on this lane, and `orchestratorLaunchEnabled` already stands in
 * for the click here (the toggle IS the standing consent), so a directive can
 * never produce it and the column must never be able to store it.
 */
export type LaunchRefusalReason =
  | "cap"
  | "busy"
  | "no-sdk"
  | "auth-hold"
  | "no-bridge"
  | "no-counterparty"
  | "no-template";

/**
 * ONE LAUNCH REQUEST from an operator's external agent to that operator's own
 * desktop.
 *
 * ⚠ **NOT A MESSAGE, AND DELIBERATELY OFF `channel_messages`** — INVARIANTS §5.
 * Two reasons, each sufficient: the LOOP BRAKE (an agent-authored addressed
 * message triggers a listener, so a "start an agent" message would be a
 * self-feeding cycle costing a consent decision per hop) and TRANSCRIPT PURITY
 * (a directive is not addressed to the counterparty, is refused more often than
 * not, and would leak the operator's orchestration into a room the other member
 * reads). The consequence to know: **a directive has no `seq` and can never end
 * an `await`.**
 *
 * ⚠ `status` is the REPORTED one, expiry already applied. It may differ from the
 * stored column — expiry is lazy and there is no cron.
 */
export type LaunchDirective = {
  id: string;
  /**
   * The operator whose machine this asks to launch — **always the reader's own
   * id, never anyone else's** (2026-08-23, F-284).
   *
   * ⚠ NOT A DISCLOSURE. Every read that produces this DTO is fenced on
   * `operator_user_id = ctx.userId` in `server/repository-launch.ts`, so this
   * field can only echo the caller back to itself.
   * ⚠ IT IS HERE FOR THE DESKTOP'S LOCAL RE-CHECK, which is the one consumer
   * that cannot take the fence on trust: `main/launch-directives.js › handle`
   * compares it against the signed-in user before acting, because the same
   * function also receives RAW realtime rows (`payload.new`), which arrive under
   * a subscription, not under a per-row auth answer. Without this field the
   * polled half compared against `''` and dropped every row.
   */
  operatorUserId: string;
  channelId: string;
  /** Thread the agent should work, or null. */
  threadId: string | null;
  goal: string | null;
  model: string | null;
  /**
   * The agent template this directive asks the machine to run AS — resolved
   * server-side, under the ORCHESTRATOR's visibility, before the row was written
   * (2026-08-23). `null` when none was named, **or when the template has since
   * been DELETED** (`ON DELETE SET NULL`).
   *
   * ⚠ **NEVER READ IT WITHOUT {@link LaunchDirective.templateName}.** Those two
   * nulls mean opposite things and the desktop acts on the difference: no
   * template requested → launch blank; template deleted → REFUSE `no-template`,
   * because the orchestrator picked an IDENTITY and an agent silently wearing
   * none is not noticed for several turns. Spec E-4.
   */
  templateId: string | null;
  /** The template's name as it stood AT CREATE. ⚠ A SNAPSHOT, deliberately not a
   *  join: it is the only thing that survives the FK's SET NULL, which is what
   *  makes a deletion distinguishable from "no template was asked for". */
  templateName: string | null;
  status: "pending" | "claimed" | "launched" | "refused" | "expired";
  /** Set iff `status` is `refused`. */
  refusalReason: LaunchRefusalReason | null;
  /** The agent instance the desktop started. Set iff `status` is `launched` —
   *  it is what the requester types as `@<agentId>` to direct it. */
  agentId: string | null;
  claimedAt: string | null;
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
};
