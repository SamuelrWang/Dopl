import "server-only";
// ⚠ THE ONE CROSS-FEATURE IMPORT ON THIS PATH, AND IT IS THE COMPOSITION RATHER
// THAN THE COPY. `resolveTemplateRef` applies `canSeeTemplate` — the visibility
// matrix that is ALREADY written twice (that function and
// `agent_templates_member_select`) and documented as having to move together. A
// third statement of it here is precisely the shape F-278 is filed against
// ("the copy is the one that will not notice"). INVARIANTS §1 says there are no
// cross-feature imports; F-275 records that the tree has never obeyed that and
// that `channels → agent-templates` already exists on the client side.
import {
  resolveTemplateRef,
  type TemplateRefMatch,
} from "@/features/agent-templates/server/service";
import { LAUNCH_DIRECTIVE_TTL_MS, PRESENCE_ONLINE_WINDOW_MS } from "../constants";
import type {
  LaunchDirective,
  LaunchMessageMode,
  LaunchRefusalReason,
  LaunchToolMode,
} from "../types";
import {
  LaunchDirectiveNotClaimableError,
  LaunchDirectiveNotFoundError,
  LaunchTemplateAmbiguousError,
  LaunchTemplateNotFoundError,
} from "./errors";
import * as launchRepo from "./repository-launch";
import * as collab from "./repository-collab";
import * as repoTasks from "./repository-tasks";
import { loadVisibleChannel, type ChannelContext } from "./service-shared";
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
};

/**
 * ⚠ WHAT A DIRECTIVE STORES ABOUT A TEMPLATE, AND WHY IT IS NOT THE CONTENT.
 *
 * The row carries the resolved `id` plus a NAME SNAPSHOT and nothing else. The
 * INSTRUCTIONS, fields and knowledge bases are read on the DESKTOP, at spawn,
 * under the OPERATOR's own credential (`main/template-resolve.js`) — which is
 * load-bearing rather than tidy: `knowledgeBases` is viewer-filtered, and on this
 * lane the caller who NAMED the template and the operator who RUNS it are
 * routinely different people. Resolving content here would attach the
 * orchestrator's reach to the operator's session.
 */
type DirectiveTemplate = { id: string; name: string } | null;

/**
 * RESOLVE THE CALLER'S `template` REF — **the CREATE fence, under the
 * ORCHESTRATOR's credential** (spec §3e).
 *
 * ⚠ THERE ARE TWO FENCES ON THIS LANE AND THEY BELONG TO DIFFERENT PEOPLE. This
 * one says the caller cannot NAME what it cannot SEE. The other runs on the
 * desktop at spawn and says the OPERATOR cannot RUN what THEY cannot see. Both
 * are required and neither substitutes: a `team` template the orchestrator is in
 * and the operator is not passes here and is refused there, as `no-template`.
 * That is a real, fail-closed state, stated in the docs rather than debugged.
 *
 * ⚠ AMBIGUITY REFUSES AND LISTS. Never picks — see
 * {@link LaunchTemplateAmbiguousError}.
 */
async function resolveTemplateForDirective(
  ctx: ChannelContext,
  ref: string | undefined
): Promise<DirectiveTemplate> {
  if (ref === undefined) return null;
  const resolution = await resolveTemplateRef(
    {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      source: ctx.source,
      role: ctx.role,
      // ⚠ CARRIED, NOT DROPPED, AND IT IS ARM 2 OF THE MATRIX (M-10). A
      // workspace-scoped API key may be shared between humans, so it inherits no
      // one person's reach and must see NOTHING beyond `visibility: 'workspace'`.
      // `canSeeTemplate` reads this field; handing it `null` would let such a key
      // resolve the key-owner's private templates by name.
      apiKeyWorkspaceId: ctx.apiKeyWorkspaceId ?? null,
      // ⚠ AND ITS KIND, OR ARM 2 REFUSES THE OPERATOR'S OWN SESSION (F-333).
      // Dropping this line puts `AGENT_TEMPLATE_NOT_FOUND` on every private
      // template a locked session names — including every "Use in this channel"
      // copy, which `containerCopyDraft` forces to `private`.
      apiKeyWorkspaceLockKind: ctx.apiKeyWorkspaceLockKind ?? null,
    },
    ref
  );
  if (resolution.kind === "ambiguous") {
    throw new LaunchTemplateAmbiguousError(
      ref,
      resolution.matches as ReadonlyArray<TemplateRefMatch>
    );
  }
  if (resolution.kind === "not-found") {
    throw new LaunchTemplateNotFoundError(ref);
  }
  // ⚠ THE SAME 404, WITH THE ONE FACT THAT MAKES IT ACTIONABLE (T35). A ref that
  // resolves in a tenancy the caller belongs to but NOT in this channel's is the
  // commonest miss on this lane and the one whose honest cause the old sentence
  // could not name. The classification is the template feature's — this file
  // adds no rule of its own to it, it only carries the answer.
  if (resolution.kind === "elsewhere") {
    throw new LaunchTemplateNotFoundError(ref, resolution.template);
  }
  return { id: resolution.id, name: resolution.name };
}

/**
 * `offline` = no row was created and nothing was asked; the caller renders the
 * honest caveat. Any other outcome carries the filed directive.
 */
export type CreateLaunchResult =
  | { offline: true; directive: null }
  | { offline: false; directive: LaunchDirective };

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

  if (!(await operatorIsOnline(ctx))) {
    return { offline: true, directive: null };
  }

  const now = Date.now();
  const row = await launchRepo.insertLaunchDirective(ctx.userId, {
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
    expires_at: new Date(now + LAUNCH_DIRECTIVE_TTL_MS).toISOString(),
  });
  return { offline: false, directive: toDirective(row, now) };
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
