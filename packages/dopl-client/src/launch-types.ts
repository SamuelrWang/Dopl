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
 *
 * ⚠ **THE FOUR CLOSED SETS ARE DECLARED IN `@dopl/contracts › directives.ts`
 * AND RE-EXPORTED HERE** (2026-09-02, v2 slice A13) — they were hand mirrors of
 * `src/features/channels/types-launch.ts` with no script between them. No
 * consumer import changed. ⚠ {@link LaunchToolMode} and {@link LaunchMessageMode}
 * are ORDERED NARROWEST FIRST and the desktop's clamp is an index comparison
 * over that order, so read the declaration before re-spelling either.
 */
import type {
  LaunchRefusalReason,
  LaunchDirectiveKind,
  LaunchToolMode,
  LaunchMessageMode,
} from "@dopl/contracts";

export type {
  LaunchRefusalReason,
  LaunchDirectiveKind,
  LaunchToolMode,
  LaunchMessageMode,
};

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
  /** Which verb this asks for. ⚠ `launch` on every row that names no kind. */
  kind: LaunchDirectiveKind;
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
  /** ⚠ `done` IS THE NON-LAUNCH KINDS' SUCCESS and `launched` IS THE LAUNCH'S.
   *  They are two words because this row is rendered into an agent-facing
   *  sentence, and "launched" on the record of an agent being STOPPED is the one
   *  kind of wrong nothing downstream can detect. */
  status: "pending" | "claimed" | "launched" | "done" | "refused" | "expired";
  /** Set iff `status` is `refused`. */
  refusalReason: LaunchRefusalReason | null;
  /** WHICH AGENT an `end` / `rename` acts on — an INPUT you named. `null` on a
   *  launch. ⚠ Never confuse it with `agentId` below, which is the OUTPUT a
   *  launch produced. */
  targetAgentId: string | null;
  /** The rename's new display name. Non-null iff `kind` is `rename`, where `""`
   *  is legal and means CLEAR (back to `Agent #<id>`). ⚠ Display only, on one
   *  machine — nothing resolves an agent by it. */
  targetName: string | null;
  /**
   * THE POSTURE A **LAUNCH** ASKED ITS NEW SESSION TO START ON (T24). `null` on
   * an axis is "not asked", which resolves to the operator's own stored channel
   * value. `null` on every kind but `launch`.
   * ⚠ SEPARATE FROM {@link LaunchDirective.targetToolMode} — one is the posture a
   * NEW session starts on, the other the posture a RUNNING one moves to.
   */
  startToolMode: LaunchToolMode | null;
  startMessageMode: LaunchMessageMode | null;
  /** MAY THE LAUNCHED AGENT LAUNCH FURTHER AGENTS? **A TRUE TRI-STATE** (fixed
   *  2026-09-01): `true` ASKED IT ON, `false` ASKED IT OFF, `null` did not ask and
   *  inherits the channel setting. ⚠ `true` is REFUSED rather than clamped when
   *  the channel forbids it — the one asymmetry with the two axes. ⚠ `false` is
   *  ALWAYS granted and WINS over a channel set to ON: it only ever narrows, so
   *  there is nothing for the operator setting to protect.
   *  ⚠ This said `false` was indistinguishable from `null`, which was true while
   *  the desktop's narrower read only `true`/`"true"`. It no longer does. */
  chain: boolean | null;
  /** THE POSTURE A `set_agent_mode` ASKED A **RUNNING** AGENT TO MOVE TO. `null`
   *  on an axis means it was not requested, which is ordinary; at least one is
   *  non-null on that kind and both are `null` on every other. */
  targetToolMode: LaunchToolMode | null;
  targetMessageMode: LaunchMessageMode | null;
  /**
   * **THE ECHO — what the machine says it actually applied, after its clamp.**
   *
   * ⚠ **`null` MEANS "NOT REPORTED". NOT "unclamped", and NEVER the requested
   * value echoed back.** The writer is the DECIDE and it landed on 2026-09-01,
   * but `null` is still the live value on every row written before that wave and
   * on every row decided by a desktop older than it — the decide's echo fields
   * are optional so such a machine can still report. A reader that treats `null`
   * as agreement tells its caller the posture landed on the strength of a field
   * nobody filled in.
   * ⚠ `appliedChain: null` IS NOT `false` — reading it as "no chaining" is wrong
   * in the direction that makes an orchestrator do the work itself for no reason.
   */
  appliedToolMode: LaunchToolMode | null;
  appliedMessageMode: LaunchMessageMode | null;
  appliedChain: boolean | null;
  /**
   * **WHAT THE SERVER PERMITTED** (2026-09-02, A9 — G6/G7/G8), decided at
   * creation from the request and the channel's own ceiling.
   *
   * ⚠ **A THIRD GROUP, NOT A SPELLING OF EITHER OTHER ONE.** `startToolMode` is
   * what was ASKED, `applied*` is what the MACHINE says it did, and this is what
   * the SERVER allowed to be asked — the half that happens whether or not a
   * machine is listening. ⚠ `null` STILL MEANS "DID NOT ASK" and survives the
   * clamp: a request that named no posture stays unnamed all the way to the
   * machine, which then applies the OPERATOR's own stored pair.
   * ⚠ **`resolvedModel` IS AN ECHO, NOT A GATE** — the canonical id a recognised
   * request resolved to, `null` for one this server does not know. Read it beside
   * `model`: both null = nothing asked; `model` set and this null = asked and
   * unrecognised, so the machine will use its own default (G8).
   * ⚠ Hand mirror of `src/features/channels/types-launch.ts › LaunchDirective`,
   * which carries the full argument.
   */
  resolvedToolMode?: LaunchToolMode | null;
  resolvedMessageMode?: LaunchMessageMode | null;
  resolvedChain?: boolean | null;
  resolvedModel?: string | null;
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
  /**
   * THE POSTURE THIS LAUNCH **ASKS** ITS NEW SESSION TO START ON, and whether it
   * may launch workers (T24, 2026-09-01).
   *
   * ⚠ **ASKS, NEVER WIDENS.** The operator's machine clamps both axes to that
   * operator's own stored channel posture and REFUSES a chain the channel
   * forbids. Omitting all three is the pre-T24 behaviour exactly: the operator's
   * own stored pair, and the channel's own chain setting.
   * ⚠ **`chain` IS A TRI-STATE AND `false` DOES TURN CHAINING OFF** (fixed
   * 2026-09-01). `true` asks it on and is REFUSED where the channel forbids it;
   * `false` asks it off, is always granted, and WINS over a channel set to ON;
   * OMITTING it inherits the channel setting. ⚠ This said `false` did nothing,
   * which was true while the desktop's narrower read only `true` — it no longer
   * does, and omitting is still not the same as sending `false`.
   */
  tools?: LaunchToolMode;
  messages?: LaunchMessageMode;
  chain?: boolean;
  /**
   * **AN IDEMPOTENCY KEY — "a retry may not queue a SECOND agent"** (2026-09-02,
   * A10/G10).
   *
   * ⚠ **SEND ONE WHENEVER A RETRY IS POSSIBLE, WHICH ON THIS OP IS ALWAYS.** The
   * create holds for the operator's machine and then returns PENDING; a timeout
   * is indistinguishable from a lost response, so without a key the caller has to
   * choose between an unknown outcome and a second agent on the same work.
   * Re-sending the same key returns the FIRST request's directive
   * ({@link LaunchDirectiveCreated}'s `existing`).
   * ⚠ Any stable string of the caller's own, 1-200 chars. Uniqueness is scoped to
   * `(channel, this operator)` server-side, so another member's key cannot
   * collide with yours.
   */
  clientMsgId?: string;
}

/**
 * ⚠ `offline: true` IS A NORMAL 200, NOT AN ERROR. The operator's machine is not
 * listening, **no row was created**, and nothing was asked. Render the caveat;
 * do not retry, and do not classify it as a failure.
 *
 * ⚠ **`existing: true` MEANS THIS CALL FILED NOTHING** (2026-09-02, A10/G10) —
 * the `clientMsgId` had been used before and this is the FIRST request's
 * directive. Render it as a converged retry, never as a fresh launch: the two are
 * the same shape and only this flag separates "your retry was absorbed" from "a
 * second agent was requested".
 * ⚠ **OPTIONAL, BECAUSE A SERVER OLDER THAN THIS WAVE SENDS NO SUCH KEY** and
 * this client is deployed against both (INVARIANTS §13). Absent reads as `false`
 * — "a row was filed" — which is the safe direction against an old server,
 * because an old server also stored no key and every call there really was fresh.
 */
export type LaunchDirectiveCreated =
  | { offline: true; directive: null }
  | { offline: false; directive: LaunchDirective; existing?: boolean };

/**
 * WHAT `createAgentDirective` ASKS FOR — END or RENAME one of the operator's own
 * running agents (2026-09-01).
 *
 * ⚠ A DISCRIMINATED UNION: a rename REQUIRES a name and an end must not carry
 * one, which the column CHECK also says at rest.
 * ⚠ **THERE IS NO OPERATOR FIELD AND THERE MUST NEVER BE ONE** — the server
 * stamps the authenticated caller, because the only machine an agent may reach is
 * its own operator's.
 * ⚠ `channel` IS REQUIRED even though `agentId` addresses the target on its own:
 * the create proves a MEMBERSHIP ROW in that channel, which is what stops this
 * being a bare "end agent `abcdefgh`" primitive with no room the caller had to be
 * in first.
 */
export type AgentDirectiveCreateInput =
  | { kind: "end"; channel: string; agentId: string }
  /** ⚠ `name: ""` IS LEGAL AND MEANS CLEAR. A separate "unname" verb would be a
   *  second way to say one thing. Bounded at 60 — the desktop store's own cap. */
  | { kind: "rename"; channel: string; agentId: string; name: string }
  /**
   * **RE-POSTURE A RUNNING AGENT** (2026-09-01).
   *
   * ⚠ **BOTH AXES OPTIONAL, AT LEAST ONE REQUIRED** — the route's schema refuses
   * the empty ask with a 400 rather than filing a row nothing could answer.
   * ⚠ **ASKS, NEVER WIDENS.** The machine clamps each axis to the operator's own
   * stored channel posture; there is no operator carve-out, because every caller
   * on this lane already IS the operator's own account.
   * ⚠ **NO MODEL FIELD, AND THERE MUST NEVER BE ONE** — the desktop's narrower
   * has no column for one, so it would be accepted and silently dropped.
   * ⚠ **THIS ONE IS BEHIND THE MACHINE'S LAUNCH TOGGLE** while `end` and `rename`
   * are not, so `no-bridge` here CAN mean the toggle is off — the opposite of what
   * that word means on the other two kinds.
   */
  | {
      kind: "set_agent_mode";
      channel: string;
      agentId: string;
      tools?: LaunchToolMode;
      messages?: LaunchMessageMode;
    };

/**
 * ⚠ `offline: true` IS A NORMAL 200, NOT AN ERROR — the launch create's rule
 * verbatim. The operator's machine is not listening, **no row was created**, and
 * nothing was asked.
 */
export type AgentDirectiveCreated =
  | { offline: true; directive: null }
  | { offline: false; directive: LaunchDirective };
