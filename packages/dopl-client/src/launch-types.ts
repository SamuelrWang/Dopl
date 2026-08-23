/**
 * LAUNCH-OVER-MCP types — asking an operator's OWN desktop to start an agent.
 *
 * ⚠ SPLIT OUT OF `channel-types.ts` on 2026-08-22, at the 500-line cap (that
 * file measured 505 with these in it). Re-exported from `index.ts` exactly as
 * before, so no consumer import changed.
 *
 * ⚠ THE ONE THING TO CARRY AWAY: **a directive is a REQUEST, not a command, and
 * it is NOT A MESSAGE.** It never touches `channel_messages` (the loop brake and
 * transcript purity), so it has no `seq` and can never end an `await`.
 */

/**
 * WHY A DESKTOP SAID NO TO A LAUNCH — **exactly six words**, the wire contract
 * both trees code against.
 *
 * ⚠ A KEY, NEVER A SENTENCE: the readable line is written by the READER, so a
 * reword does not need a desktop release and no desktop-authored prose is
 * rendered into an agent-facing result.
 *
 *  - `cap`             — at the machine's concurrent-agent ceiling.
 *  - `busy`            — under load, declined for now.
 *  - `no-sdk`          — no agent runtime on that machine.
 *  - `auth-hold`       — signed out, or the credential is held.
 *  - `no-bridge`       — ⚠ the operator's launch-over-MCP TOGGLE IS OFF. This is
 *                        the consent mechanism, so it is a CHOICE and must never
 *                        be rendered as a fault or a thing to retry.
 *  - `no-counterparty` — nothing to work with in that channel.
 *  - `no-template`     — ⚠ THE SEVENTH, 2026-08-22 (agent templates). The named
 *                        TEMPLATE did not resolve on the operator's machine:
 *                        deleted, or not visible to the OPERATOR even though the
 *                        orchestrator that named it could see it. One answer for
 *                        both, deliberately — the resolve endpoint is
 *                        404-never-403, so the difference is not observable and a
 *                        render that guessed would rebuild the oracle.
 *
 * ⚠ `template-approval` IS NOT A MEMBER. That word is the desktop's answer to its
 * OWN renderer when a foreign template needs its one first-use click; the directive
 * lane has no human and the launch-over-MCP toggle stands in for the click there,
 * so it can never cross this wire.
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
 * ⚠ **NOT A MESSAGE.** It never touches `channel_messages` — the loop brake (an
 * agent-authored addressed message triggers a listener, so "start an agent" as a
 * message would be a self-feeding cycle) and transcript purity. **So it has no
 * `seq` and can never end an `await`**: hold on the directive itself, or find the
 * result in `read_sessions`.
 *
 * ⚠ `status` has LAZY EXPIRY already applied by the server and may differ from
 * what is stored. `expired` means nothing claimed it in time — not that anything
 * failed.
 */
export interface LaunchDirective {
  id: string;
  /**
   * The operator whose machine was asked — **always your own id** (2026-08-23).
   * The read is fenced on it server-side, so it echoes the caller back rather
   * than telling you anything new. It exists because the desktop re-checks
   * ownership locally before it acts on a directive.
   */
  operatorUserId: string;
  channelId: string;
  threadId: string | null;
  goal: string | null;
  model: string | null;
  /**
   * The agent template the machine is asked to run AS, resolved SERVER-SIDE under
   * the requester's visibility before the row was written (2026-08-23). `null`
   * when none was named — **or when the template was deleted afterwards**.
   *
   * ⚠ READ IT BESIDE {@link LaunchDirective.templateName}: a null id with a live
   * name is a DELETION, and the desktop refuses (`no-template`) rather than
   * launching a blank agent.
   */
  templateId: string | null;
  /** The template's name AT CREATE TIME — a snapshot, never a join, so it
   *  survives the id's `ON DELETE SET NULL`. */
  templateName: string | null;
  status: "pending" | "claimed" | "launched" | "refused" | "expired";
  /** Set iff `status` is `refused`. */
  refusalReason: LaunchRefusalReason | null;
  /** The agent instance started. Set iff `status` is `launched` — it is what a
   *  requester types as `@<agentId>` to direct it. */
  agentId: string | null;
  claimedAt: string | null;
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

/** What `createLaunchDirective` asks for. ⚠ THERE IS NO OPERATOR FIELD AND THERE
 *  MUST NEVER BE ONE — the server stamps the authenticated caller, because the
 *  only machine an agent may ask to start something is its own operator's. */
export interface LaunchDirectiveCreateInput {
  channel: string;
  threadId?: string;
  goal?: string;
  model?: string;
  /**
   * The agent template to run as — **an id OR an exact name** (2026-08-23). One
   * param for both, the same idiom `dopl_kb`'s `base` already uses.
   *
   * ⚠ RESOLVED SERVER-SIDE, under the CALLER's own visibility, before any row is
   * written. A name matching more than one visible template is REFUSED with the
   * list (409 `AGENT_TEMPLATE_AMBIGUOUS`, `details.matches`) — never picked.
   */
  template?: string;
}

/**
 * ⚠ `offline: true` IS A NORMAL 200, NOT AN ERROR. The operator's machine is not
 * listening, **no row was created**, and nothing was asked. Render the caveat;
 * do not retry, and do not classify it as a failure.
 */
export type LaunchDirectiveCreated =
  | { offline: true; directive: null }
  | { offline: false; directive: LaunchDirective };
