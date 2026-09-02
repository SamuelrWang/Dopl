import "server-only";
import { LAUNCH_DIRECTIVE_TTL_MS, PRESENCE_ONLINE_WINDOW_MS } from "../constants";
import type {
  LaunchDirective,
  LaunchMessageMode,
  LaunchRefusalReason,
  LaunchToolMode,
} from "../types";
import {
  ChannelAgentChainForbiddenError,
  LaunchDirectiveNotClaimableError,
  LaunchDirectiveNotFoundError,
} from "./errors";
// ⚠ THE CLAMP IS A SHARED LIB, NOT A BRANCH HERE — it is a second copy of the
// desktop's rule across a tree boundary the two cannot import over, so it lives
// in one place with a parity test rather than inline in a service.
import {
  chainRefused,
  clampPosture,
  resolveChain,
} from "../lib/agent-posture";
import { resolveAgentModelId } from "../lib/agent-models";
import { mapAgentPosture } from "./dto";
import * as launchRepo from "./repository-launch";
import * as collab from "./repository-collab";
import * as repoTasks from "./repository-tasks";
import { loadVisibleChannel, type ChannelContext } from "./service-shared";
// ⚠ THE RACE HALF OF G10, SHARED WITH THE DIRECTION LANE — see that module for
// why the PROBE is not in it and this file states its own gate ordering instead.
import { insertOrConverge } from "./service-mailbox-idempotency";
// ⚠ THE TEMPLATE FENCE LEFT THIS FILE ON 2026-09-02 (§1 cap). It is the CREATE's
// third gate and its position in the order is argued below, where the gates are.
import { resolveTemplateForDirective } from "./service-launch-template";
// ⚠ THE MAPPER AND THE REFUSAL VOCABULARY LEFT THIS FILE ON 2026-09-01 (§1 cap,
// and a second service now reads both — `service-launch-agent.ts`). RE-EXPORTED
// below so no import path outside this feature changed and there is still no
// second path to either symbol.
import { isTerminal, toDirective } from "./service-launch-dto";
export { LAUNCH_REFUSAL_REASONS, toDirective } from "./service-launch-dto";

/**
 * LAUNCH-OVER-MCP — an operator's external agent asking that operator's OWN
 * desktop to start an agent (Samuel's ruling, 2026-08-22: approved, with a local
 * desktop toggle as the consent).
 *
 * ⚠ **THE SERVER STARTS NOTHING, AND CANNOT.** Agents live in a desktop main
 * process no server can reach. What this service does is FILE A REQUEST and
 * report what came back. Every result sentence has to survive that: "launched"
 * means a machine SAID it launched, and there is no third party to check it
 * against.
 *
 * ⚠ **`operator_user_id` IS ALWAYS `ctx.userId` AND IS NEVER A PARAMETER.** Not
 * on the create, not on the claim, not on the decide. An agent may ask its own
 * operator's machine to do something; the ability to name a DIFFERENT operator
 * would be the ability to start a process on a stranger's computer, and the way
 * to make that unreachable is for no function in this file to accept the
 * argument. The type signatures below are the enforcement, not a convention.
 */

/**
 * IS THE OPERATOR'S MACHINE EVEN THERE?
 *
 * ⚠ **A HINT, AND THE RESULT MUST SAY SO.** `agent_presence` is per-(user,
 * workspace), not per-machine and not per-channel: it says some listener of this
 * operator's heartbeat recently, not that the machine which would run this agent
 * is up, not that the desktop's launch toggle is on, and not that it has an SDK.
 * So an ONLINE reading proves nothing and the flow continues to the real
 * decision, which is the desktop's.
 * ⚠ What it DOES buy is the OFFLINE case, which is the common one and the one
 * worth short-circuiting: filing a directive against a machine that is provably
 * not listening produces a row nobody will ever claim, a 15-second hold, and a
 * timeout the agent has to interpret. Refusing before the row exists turns that
 * into an immediate, honest answer.
 * ⚠ THE WINDOW IS `PRESENCE_ONLINE_WINDOW_MS`, deliberately reused — a second
 * liveness number would let the roster call a member offline while this path
 * happily filed a directive for them.
 */
// ⚠ EXPORTED SINCE 2026-09-01 for `service-launch-agent.ts` — the SAME question,
// the SAME window, and a second copy would let one lane call a machine online
// while the other filed nothing for it.
export async function operatorIsOnline(
  ctx: ChannelContext
): Promise<boolean> {
  const presence = await collab.presenceForWorkspace(ctx.workspaceId);
  const mine = presence.get(ctx.userId);
  // ⚠ NO ROW AND NO STAMP BOTH READ AS OFFLINE — the fail-safe direction. A
  // presence projection that cannot say when it last heard from a machine is not
  // evidence the machine is up, and the cost of being wrong this way is one
  // honest refusal instead of a directive nobody will ever claim.
  if (!mine?.lastSeenAt) return false;
  // ⚠ Recomputed from the stamp rather than trusting `online`, so this path
  // cannot drift from the window even if that projection is later re-derived.
  const seenAt = Date.parse(mine.lastSeenAt);
  if (Number.isNaN(seenAt)) return false;
  return Date.now() - seenAt < PRESENCE_ONLINE_WINDOW_MS;
}

export type CreateLaunchInput = {
  /** Channel slug or id. ⚠ Resolved through the ordinary visibility gate. */
  channel: string;
  /** Thread to start the agent on. Must belong to `channel`. */
  threadId?: string;
  goal?: string;
  model?: string;
  /**
   * The agent template to run as — **an id OR an exact name**, resolved here
   * (2026-08-23).
   *
   * ⚠ IT IS A REF, NOT AN ID, AND THE RESOLUTION IS THE FENCE. `channels/`
   * never sees a template id it did not obtain by asking the agent-templates
   * service what THIS caller can see, so "name a template you cannot see" has no
   * spelling on this path. See {@link resolveTemplateForDirective}.
   */
  template?: string;
  /**
   * THE POSTURE THIS LAUNCH **ASKS** ITS NEW SESSION TO START ON, and whether it
   * may launch workers (2026-09-01, T24).
   *
   * ⚠ **ASKS. NEVER WIDENS — AND THIS SERVICE DOES NOT AND CANNOT CHECK THAT.**
   * The ceiling is the operator's own stored channel posture, an
   * `electron-store` record no server sees; `main/launch-posture.js ›
   * resolveLaunch` CLAMPS the two axes to it and REFUSES a chain the channel
   * forbids. All this path does is carry the request.
   * ⚠ **THE TICKET'S "unless the caller is the operator" CARVE-OUT WAS REFUSED,
   * and the reason is measurable here: every caller on this lane IS the
   * operator's own account** (INVARIANTS §11), so the exception is not narrow,
   * it is the whole set. Do not add one.
   * ⚠ OMITTING ALL THREE IS THE PRE-T24 BEHAVIOUR BYTE FOR BYTE.
   */
  tools?: LaunchToolMode;
  messages?: LaunchMessageMode;
  chain?: boolean;
  /**
   * **THE CALLER'S IDEMPOTENCY KEY — "a retry may not queue a SECOND agent"**
   * (2026-09-02, A10/G10).
   *
   * ⚠ **IT IS THE ONLY THING THAT MAKES THE SURFACE'S STRONGEST WARNING TRUE.**
   * `op="launch_agent"` holds ~15 s and then returns PENDING, and the doctrine
   * tells the caller not to re-issue because a second launch starts a second
   * agent on the same work. That was enforced by NOTHING. Sending the same key
   * again now returns the stored directive instead
   * ({@link CreateLaunchResult.existing}).
   * ⚠ ABSENT IS THE ORDINARY CASE and changes nothing — see
   * `service-mailbox-idempotency.ts`.
   */
  clientMsgId?: string;
};

/**
 * `offline` = no row was created and nothing was asked; the caller renders the
 * honest caveat. Any other outcome carries the filed directive.
 *
 * ⚠ **`existing: true` MEANS THE ROW WAS ALREADY THERE — this call filed
 * NOTHING** (2026-09-02, A10/G10). The caller re-sent a `clientMsgId` it had
 * used before and got the FIRST request's directive back, which is the whole
 * point: a timed-out launch may be retried without starting a second agent. The
 * MCP result renders it as `retry=existing`, because a converged retry that
 * looked like a fresh launch would leave the caller guessing exactly what the
 * key removed.
 */
export type CreateLaunchResult =
  | { offline: true; directive: null }
  | { offline: false; directive: LaunchDirective; existing: boolean };

/**
 * FILE A LAUNCH DIRECTIVE.
 *
 * THREE GATES, IN THIS ORDER, AND THE ORDER IS THE CHEAPNESS ORDER:
 *  1. **THE CHANNEL MUST BE VISIBLE AND THE CALLER MUST BE A MEMBER.**
 *     `loadVisibleChannel` alone is NOT enough here and this is the one place in
 *     the feature that says so out loud: it admits a non-member to a PUBLIC
 *     channel (§5), and a launch is not a read. Starting an agent in a room you
 *     never joined is not something a member of the room agreed to, so the
 *     membership row is required on top.
 *  2. **A `threadId`, IF GIVEN, MUST BELONG TO THAT CHANNEL.** Otherwise a
 *     directive could stamp an agent onto an exchange in a different room —
 *     including one the caller cannot read. Refused, never silently dropped: a
 *     dropped thread id starts the agent in the wrong place and reports success.
 *  3. **THE TEMPLATE REF, IF GIVEN, MUST RESOLVE FOR THIS CALLER** (2026-08-23).
 *     Id or exact name, through the agent-templates visibility matrix; ambiguous
 *     names REFUSE and list. See {@link resolveTemplateForDirective}.
 *  4. **PRESENCE.** See {@link operatorIsOnline} — the only gate that can pass
 *     while the answer is still "no", which is why it is last and why it does
 *     not pretend to be a decision.
 *
 * ⚠ **THE TEMPLATE GATE IS DELIBERATELY ABOVE PRESENCE, WHICH BREAKS THE
 * CHEAPNESS ORDER ON PURPOSE.** `offline` is a 200 that says "nothing was asked",
 * and it is the ordinary answer for a closed laptop. Checking presence first
 * would answer a MISSPELLED OR AMBIGUOUS TEMPLATE with "your machine is asleep" —
 * the caller fixes the wrong thing, asks again when the machine is up, and gets
 * the real refusal a minute later. A bad ref is the caller's own error and is
 * answerable without anyone's machine.
 *
 * ⚠ `operator_user_id` is `ctx.userId`. {@link CreateLaunchInput} has no field
 * for it.
 */
export async function createLaunchDirective(
  ctx: ChannelContext,
  input: CreateLaunchInput
): Promise<CreateLaunchResult> {
  const { channel, membership } = await loadVisibleChannel(ctx, input.channel);
  if (membership === null) {
    // ⚠ NOT-FOUND-SHAPED on purpose: to a non-member of a public channel this
    // reads exactly like a private channel they cannot see, which is the answer
    // §5 gives everywhere else. A distinct "you may read but not launch" error
    // would be a new fact about the room.
    throw new LaunchDirectiveNotFoundError(input.channel);
  }

  // ⚠ **THE IDEMPOTENCY PROBE SITS HERE — ABOVE THE THREAD, TEMPLATE AND
  // PRESENCE GATES — AND THE POSITION IS THE CONTRACT** (2026-09-02, A10/G10).
  // A key that has already been filed means THIS REQUEST ALREADY HAPPENED, so the
  // honest answer is the stored row and nothing else may be re-decided against
  // today's world:
  //   • THE TEMPLATE GATE would refuse a retry of a launch that SUCCEEDED, if the
  //     template has since been deleted or unshared. The row already names the id
  //     it resolved to.
  //   • THE PRESENCE GATE would answer `offline` — "nothing was filed" — about a
  //     directive that IS filed and may be running. That is the double-launch
  //     hazard inverted, and it is the reading most likely to make a caller retry.
  // ⚠ It is BELOW membership because the fence may never be skipped: converging
  // on a stored row is still a read of a channel the caller must be in.
  if (input.clientMsgId) {
    const stored = await launchRepo.findLaunchDirectiveByClientMsgId(
      ctx.userId,
      channel.id,
      input.clientMsgId
    );
    if (stored) {
      return { offline: false, directive: toDirective(stored, Date.now()), existing: true };
    }
  }

  let taskId: string | null = null;
  if (input.threadId) {
    const task = await repoTasks.findTaskByChannelAndId(
      channel.id,
      input.threadId
    );
    // ⚠ Reuses the thread-not-in-this-channel refusal rather than minting a
    // launch-specific one: it is the same fact, and ids must not be probeable
    // across channels through a new door.
    if (!task) throw new LaunchDirectiveNotFoundError(input.threadId);
    taskId = task.id;
  }

  const template = await resolveTemplateForDirective(ctx, input.template);

  // ── 5. **THE POSTURE CEILING** (2026-09-02, A9 — G6, G7, G8) ──────────────
  //
  // ⚠ **ABOVE PRESENCE, ON THE TEMPLATE GATE'S ARGUMENT.** `offline` is a 200
  // saying "nothing was asked", and answering a chain the channel forbids with
  // "your machine is asleep" makes the caller fix the wrong thing and ask again
  // a minute later for the real refusal. A ceiling is answerable without anyone's
  // machine.
  // ⚠ **AND BELOW THE IDEMPOTENCY PROBE**, with the two gates above it: a stored
  // row is this request's answer and must not be re-decided against a ceiling
  // that has moved since.
  // ⚠ **THE CEILING IS A CHANNEL COLUMN, AND `null` ON AN AXIS REFUSES AND
  // CLAMPS NOTHING.** Until this wave the ceiling was an `electron-store` record
  // no server could read, so an offline or older desktop enforced nothing at all
  // — which is what G6 and G7 record. A channel that has never had one written
  // therefore behaves exactly as it does today, and the desktop's own clamp
  // (`main/launch-posture.js`) stays the belt on every path.
  const ceiling = mapAgentPosture(channel);
  // ⚠ REFUSED, NOT CLAMPED, AND THE ASYMMETRY IS THE DESKTOP'S OWN — see
  // `ChannelAgentChainForbiddenError`. It is checked BEFORE the clamp so a
  // refusal is never reported as a narrowing.
  if (chainRefused(input.chain, ceiling)) throw new ChannelAgentChainForbiddenError();
  const posture = clampPosture(input, ceiling);

  if (!(await operatorIsOnline(ctx))) {
    return { offline: true, directive: null };
  }

  const now = Date.now();
  // ⚠ THE RACE HALF OF G10. The probe above answers the ordinary retry; this
  // answers two of them arriving together, where both probes missed and the
  // partial unique index refuses the second insert. See
  // `service-mailbox-idempotency.ts` for why the two are one rule.
  const { row, existing } = await insertOrConverge({
    clientMsgId: input.clientMsgId,
    find: (key) =>
      launchRepo.findLaunchDirectiveByClientMsgId(ctx.userId, channel.id, key),
    insert: () => launchRepo.insertLaunchDirective(ctx.userId, {
      workspace_id: ctx.workspaceId,
      channel_id: channel.id,
      task_id: taskId,
      goal: input.goal ?? null,
      model: input.model ?? null,
      // ⚠ THE PAIR, WRITTEN TOGETHER. `template_name` is a SNAPSHOT and is what
      // survives the FK's `ON DELETE SET NULL` — without it a template deleted
      // between here and the claim is indistinguishable from no template at all,
      // and the desktop would launch a blank agent wearing an identity the caller
      // asked for and will not notice is missing (E-4).
      template_id: template?.id ?? null,
      template_name: template?.name ?? null,
      // ⚠ **THE REQUESTED POSTURE, CARRIED VERBATIM AND VALIDATED NOWHERE ELSE
      // HERE.** The route's zod holds each axis to its closed enum and the column
      // CHECK says the same at rest; this path adds no opinion, because the only
      // opinion that matters is the OPERATOR'S CEILING and it lives on their
      // machine. ⚠ `?? null` maps "not asked" onto the column's own spelling for it,
      // which the desktop then resolves to that ceiling — the pre-T24 behaviour.
      // ⚠ `chain` USES `?? null` RATHER THAN `|| null` SO THE ROW RECORDS WHAT THE
      // CALLER ACTUALLY SENT. `||` would rewrite a `false` into "did not ask" here,
      // in the one place that is supposed to be a faithful record of the request.
      // ⚠ **AND SINCE 2026-09-01 THE `false` IS HONOURED, NOT MERELY RECORDED**:
      // `main/launch-directive-wire.js › directiveFrom` carries all three states and
      // `main/launch-posture.js › resolveChain` grants `false` unconditionally — it
      // only ever NARROWS, so it wins even over a channel set to ON. This comment
      // said the opposite ("promised to nobody") while the desktop flattened `false`
      // into `null`; see `types-launch.ts › LaunchDirective.chain` for the fix.
      start_tool_mode: input.tools ?? null,
      start_message_mode: input.messages ?? null,
      chain: input.chain ?? null,
      // ⚠ **THE THIRD POSTURE GROUP, AND THE CREATE IS ITS ONLY WRITER**
      // (2026-09-02, A9). `start_*` records what was ASKED and is never
      // rewritten; `applied_*` is the MACHINE's echo and is written by the
      // DECIDE; this is what the SERVER permitted. G6 asks for the applied value
      // to be non-null, and it is — by CONSTRUCTION, on every row this build
      // files, rather than by a constraint that would 500 an insert from a
      // rolled-back one.
      resolved_tool_mode: posture.tools,
      resolved_message_mode: posture.messages,
      resolved_chain: resolveChain(input.chain, ceiling),
      // ⚠ AN ECHO, NEVER A GATE (G8). `null` is "this server does not recognise
      // it", not "refused": the raw `model` above still reaches the machine, and
      // a newer desktop may run a model this build predates. What changes is that
      // the caller is now TOLD, which is the whole of G8's complaint.
      resolved_model: resolveAgentModelId(input.model),
      expires_at: new Date(now + LAUNCH_DIRECTIVE_TTL_MS).toISOString(),
      client_msg_id: input.clientMsgId ?? null,
    }),
  });
  return { offline: false, directive: toDirective(row, now), existing };
}

/**
 * **WHAT IS STILL AWAITING THIS OPERATOR'S DECISION** — the desktop's
 * breaker-open backstop (F-273).
 *
 * ⚠ EXPIRED ROWS ARE DROPPED HERE, NOT IN SQL. Expiry is lazy and
 * {@link toDirective} is the one place that decides it; a `WHERE expires_at >
 * now()` in the repository would be a SECOND rule, and two rules for one
 * question drift. The cost is reading a handful of dead rows and discarding
 * them, on a poll that only runs while realtime is DOWN for that workspace.
 *
 * ⚠ IT RETURNS `claimed` ROWS TOO — a machine that claimed and crashed before
 * deciding has to find its own row again. Nothing can re-action one: the CAS only
 * moves a row out of `pending`.
 */
export async function listPendingLaunchDirectives(
  ctx: ChannelContext
): Promise<LaunchDirective[]> {
  const now = Date.now();
  const rows = await launchRepo.listPendingLaunchDirectives(
    ctx.userId,
    ctx.workspaceId
  );
  return rows
    .map((row) => toDirective(row, now))
    .filter((d) => d.status !== "expired");
}

/** Read one directive, expiry applied. ⚠ Own-scoped in the repository. */
export async function getLaunchDirective(
  ctx: ChannelContext,
  id: string
): Promise<LaunchDirective> {
  const row = await launchRepo.findLaunchDirective(
    ctx.userId,
    ctx.workspaceId,
    id
  );
  if (!row) throw new LaunchDirectiveNotFoundError(id);
  return toDirective(row, Date.now());
}

/**
 * **THE DESKTOP LANE — CLAIM.** Move `pending → claimed`, single-winner.
 *
 * ⚠ THE FRESHNESS CHECK IS HERE AND THE ATOMICITY IS IN THE REPOSITORY, and the
 * split is deliberate: `now` is a service concern (lazy expiry lives at read
 * time), while single-winner is a database concern. Putting `expires_at > now()`
 * into the CAS would collapse "lost the race" and "too late" into one `null` and
 * the desktop could not tell a sibling machine from a stale request.
 *
 * ⚠ THREE FAILURES, THREE MEANINGS, ONE POSTURE — stand down, do not retry:
 * `expired` (too late), `taken` (a sibling machine won), `decided` (already
 * answered). All are 409.
 */
export async function claimLaunchDirective(
  ctx: ChannelContext,
  id: string
): Promise<LaunchDirective> {
  const now = Date.now();
  const existing = await launchRepo.findLaunchDirective(
    ctx.userId,
    ctx.workspaceId,
    id
  );
  if (!existing) throw new LaunchDirectiveNotFoundError(id);
  if (isTerminal(existing.status)) {
    throw new LaunchDirectiveNotClaimableError("decided");
  }
  if (now > Date.parse(existing.expires_at)) {
    throw new LaunchDirectiveNotClaimableError("expired");
  }

  const row = await launchRepo.claimLaunchDirective(
    ctx.userId,
    ctx.workspaceId,
    id,
    new Date(now).toISOString()
  );
  // ⚠ `null` HERE IS THE RACE, and only the race: the pre-read above already
  // ruled out missing / decided / expired, so the row moved between the two
  // statements. That is exactly what the CAS is for, and the loser is told.
  if (!row) throw new LaunchDirectiveNotClaimableError("taken");
  return toDirective(row, now);
}

export type DecideLaunchInput =
  /**
   * ⚠ THE LAUNCH KIND'S SUCCESS ONLY — the column CHECK pairs `launched` with
   * `kind = 'launch'`, so this arm on an `end` row is refused AT REST.
   *
   * ⚠ **THE THREE `applied*` FIELDS ARE THE ECHO, AND THEY ARE OPTIONAL FOREVER**
   * (2026-09-01). A desktop older than this wave reports nothing and must keep
   * being able to decide (INVARIANTS §13), so absent is a first-class input —
   * it maps to `null`, which every reader is required to render as "not
   * reported" rather than as agreement.
   */
  | {
      status: "launched";
      agentId: string;
      appliedTools?: LaunchToolMode;
      appliedMessages?: LaunchMessageMode;
      appliedChain?: boolean;
    }
  /** ⚠ THE NON-LAUNCH KINDS' SUCCESS (2026-09-01). No agent id: the row already
   *  NAMES its target, so a second id on the decide would be a field the machine
   *  could get wrong about a row it did not write. */
  | { status: "done" }
  | { status: "refused"; refusalReason: LaunchRefusalReason };

/**
 * **THE DESKTOP LANE — DECIDE.** Write the terminal outcome.
 *
 * ⚠ A DECISION IS FINAL. The repository's UPDATE only matches `pending` or
 * `claimed`, so a retried or duplicated decide cannot flip a `launched` into a
 * `refused` — the second call is a 409, not a silent overwrite. That matters
 * because the requester may already have read the first outcome and started
 * addressing `@<agentId>`.
 *
 * ⚠ **AN EXPIRED DIRECTIVE MAY STILL BE DECIDED, AND THAT IS NOT A BUG.** If the
 * machine really did start an agent, the truthful record is `launched` with the
 * agent id, however late it is. Refusing the write would leave a running agent
 * that no directive accounts for — the worst of the available outcomes. Expiry
 * governs whether a NEW claim may begin, not whether a completed one may be
 * reported.
 *
 * ⚠ **THE DECIDE IS THE ECHO TRIO'S ONLY WRITER, AND THAT IS THE WHOLE POINT OF
 * PUTTING IT HERE** (2026-09-01, T24's second half). `repository-launch.ts ›
 * LaunchDirectiveInsert` deliberately has no field for `applied_*`: a CREATE that
 * could stamp them would let the REQUESTER write its own confirmation, which is
 * the one value on this row that must not come from the asking side. The machine
 * that did the clamping is the only honest reporter of it.
 * ⚠ **ABSENT MAPS TO `null`, AND `null` IS "NOT REPORTED".** Never a value
 * echoed from the REQUEST columns (`start_tool_mode` / `start_message_mode` /
 * `chain`). Echoing those back would produce a value that is right whenever
 * nothing was clamped and confidently wrong precisely when it mattered, and the
 * orchestrator would size its next instruction for room the agent does not have.
 * ⚠ `?? null` RATHER THAN `|| null` ON THE CHAIN, for the reason
 * `createLaunchDirective` states about the REQUEST column: `||` would rewrite a
 * reported `false` — "I settled the chain OFF" — into "I said nothing", which is
 * the exact collapse this wave exists to remove from the other half of the lane.
 */
export async function decideLaunchDirective(
  ctx: ChannelContext,
  id: string,
  input: DecideLaunchInput
): Promise<LaunchDirective> {
  const now = Date.now();
  const row = await launchRepo.decideLaunchDirective(
    ctx.userId,
    ctx.workspaceId,
    id,
    {
      status: input.status,
      agent_id: input.status === "launched" ? input.agentId : null,
      refusal_reason:
        input.status === "refused" ? input.refusalReason : null,
      // ⚠ ONLY THE `launched` ARM CAN CARRY THESE. On `done` and `refused` they
      // are written as `null` rather than left off, so a retried decide cannot
      // leave a stale echo standing beside a refusal.
      applied_tool_mode:
        input.status === "launched" ? input.appliedTools ?? null : null,
      applied_message_mode:
        input.status === "launched" ? input.appliedMessages ?? null : null,
      applied_chain:
        input.status === "launched" ? input.appliedChain ?? null : null,
      decided_at: new Date(now).toISOString(),
    }
  );
  if (!row) {
    // ⚠ Distinguish "not yours / gone" from "already decided" — the desktop logs
    // them differently, and only one of them is worth an operator's attention.
    const existing = await launchRepo.findLaunchDirective(
      ctx.userId,
      ctx.workspaceId,
      id
    );
    if (!existing) throw new LaunchDirectiveNotFoundError(id);
    throw new LaunchDirectiveNotClaimableError("decided");
  }
  return toDirective(row, now);
}
