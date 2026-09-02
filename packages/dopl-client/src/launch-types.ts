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
  | "no-template"
  // ⚠ THE EIGHTH AND NINTH, 2026-09-01 (external `end` / `rename`). Both belong
  // to the NON-LAUNCH kinds and a launch can produce neither.
  //  - `no-session` — no LIVE session of this operator's carries that agent id on
  //    the machine that claimed the row. ⚠ NOT AN ERROR: an agent that finished
  //    is the ordinary cause. Same spelling the DIRECTION lane uses for the same
  //    fact, deliberately.
  //  - `bad-name`   — the rename's string was refused by that machine's own
  //    sanitizer (1-60 visible characters on one line; control, zero-width and
  //    bidi characters refused, not stripped).
  | "no-session"
  | "bad-name";

/**
 * WHICH VERB A DIRECTIVE ASKS FOR (2026-09-01).
 *
 * ⚠ `launch` is the DEFAULT and every row written before this existed is one, so
 * a directive that names no kind is a launch — which is what it meant.
 * ⚠ **THE KINDS DO NOT SHARE A CONSENT GATE.** `launch` is gated by a per-machine
 * desktop toggle and answers `no-bridge` when it is off; `end` and `rename` are
 * not gated at all — they are the stop verb and the display verb and widen
 * nothing. Do not tell a caller that turning the launch toggle on is what makes
 * an end work.
 * ⚠ **`set_agent_mode` IS THE FOURTH AND IT DOES **NOT** JOIN THE UNGATED PAIR**
 * (2026-09-01). It is the ONE non-launch kind still behind that toggle, because a
 * POSTURE is the only one of the three that can cause LOCAL COMPUTE TO BE SPENT
 * (`bypass` on the tool axis pre-approves work tools on the operator's own
 * hardware). Reading the three non-launch kinds as one class is the mistake this
 * sentence exists to stop.
 */
export type LaunchDirectiveKind =
  | "launch"
  | "end"
  | "rename"
  | "set_agent_mode";

/**
 * THE TWO PERMISSION AXES A DIRECTIVE MAY **ASK** FOR — **ORDERED NARROWEST
 * FIRST** (2026-09-01, T24).
 *
 * ⚠ **THE ORDER IS PART OF THE CONTRACT AND NO COMPILER CHECKS IT.** The clamp on
 * the machine is an INDEX COMPARISON over these sequences, so re-ordering either
 * union silently inverts the bound with everything still type-checking.
 *
 * ⚠ **ASKS. NEVER WIDENS, AND THERE IS NO OPERATOR CARVE-OUT.** The operator's
 * machine narrows whatever is asked for to that operator's own stored channel
 * posture. A caller that reads these as "set" will report a posture it does not
 * have, and then size its work for room the agent was never given.
 */
export type LaunchToolMode = "manual" | "accept_edits" | "auto" | "bypass";
export type LaunchMessageMode =
  | "ask"
  | "auto_inbound"
  | "auto_outbound"
  | "auto_both";

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
  /** MAY THE LAUNCHED AGENT LAUNCH FURTHER AGENTS? ⚠ A TRI-STATE: `true` asked,
   *  `false` asked for it off, `null` did not ask. ⚠ REFUSED rather than clamped
   *  when the channel forbids it — the one asymmetry with the two axes. */
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
   * value echoed back.** No writer exists yet, so all three are `null` on every
   * live row; a reader that treats `null` as agreement tells its caller the
   * posture landed on the strength of a field nobody filled in.
   * ⚠ `appliedChain: null` IS NOT `false` — reading it as "no chaining" is wrong
   * in the direction that makes an orchestrator do the work itself for no reason.
   */
  appliedToolMode: LaunchToolMode | null;
  appliedMessageMode: LaunchMessageMode | null;
  appliedChain: boolean | null;
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
   * ⚠ `chain: false` IS A REAL REQUEST and is not the same as omitting it.
   */
  tools?: LaunchToolMode;
  messages?: LaunchMessageMode;
  chain?: boolean;
}

/**
 * ⚠ `offline: true` IS A NORMAL 200, NOT AN ERROR. The operator's machine is not
 * listening, **no row was created**, and nothing was asked. Render the caveat;
 * do not retry, and do not classify it as a failure.
 */
export type LaunchDirectiveCreated =
  | { offline: true; directive: null }
  | { offline: false; directive: LaunchDirective };

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
