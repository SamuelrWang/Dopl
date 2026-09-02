import "server-only";
import { LAUNCH_DIRECTIVE_TTL_MS } from "../constants";
import type { LaunchDirective } from "../types";
import {
  AgentDirectiveForeignError,
  LaunchDirectiveNotFoundError,
} from "./errors";
import * as launchRepo from "./repository-launch";
import { agentInstanceOwner } from "./repository-agent-owner";
import { toDirective } from "./service-launch-dto";
import { operatorIsOnline } from "./service-launch";
import { loadVisibleChannel, type ChannelContext } from "./service-shared";

/**
 * **AGENT MANAGEMENT OVER MCP** — an operator's external agent asking that
 * operator's OWN desktop to END or RENAME one of its running agents (2026-09-01,
 * Samuel: *"I need you to build out dopl mcp being able to end agents. Dopl MCP
 * need to be able to do all that stuff"*).
 *
 * ── ⚠ WHY THIS RIDES `channel_launch_directives` AND NOT A NEW LANE ──────────
 *
 * These verbs already existed — INSIDE a desktop-spawned session, as
 * `mcp__dopl_agents__end_agent` / `rename_agent`
 * (`dopl-desktop-app/main/agent-self-ops.js`, 2026-08-31). What did not exist was
 * a way for an EXTERNAL session — the Claude Desktop / Claude Code process
 * holding the operator's own Dopl credential — to reach them, because **the
 * server cannot reach a desktop main process**. Exactly one mechanism in this
 * tree crosses that gap: the launch mailbox. So the verbs became KINDS of
 * directive rather than a second mailbox, and everything the lane already
 * establishes — the `operator_user_id` stamp, the claim CAS, lazy expiry, the
 * closed refusal vocabulary, the realtime binding, the breaker-open backstop —
 * governs them unchanged.
 *
 * ── ⚠ THE CONSENT DIFFERENCE, AND IT IS THE ONE THING TO CARRY AWAY ──────────
 *
 * The LAUNCH kind is gated on the desktop by the per-machine
 * `orchestratorLaunchEnabled` toggle ("THE TOGGLE IS THE CONSENT", INVARIANTS §6
 * / §11). **`end` and `rename` are NOT**, and that is a ruling recorded here
 * rather than an omission. `main/agent-self-ops.js` already carries the argument
 * in full for the in-process twins of these two verbs: a STOP verb and a DISPLAY
 * verb widen nothing — neither can start a query, wake a shell, grant a tool or
 * post — so the failure direction of an abused call is an agent that stops or a
 * card that reads differently, on the machine of the operator whose agents they
 * all are. The toggle exists to gate LOCAL COMPUTE BEING SPENT; these two spend
 * none.
 * ⚠ **NOTHING IN THIS FILE ENFORCES OR OBSERVES THAT.** The toggle is an
 * `electron-store` boolean the server never sees, and the branch that honours the
 * distinction is `main/launch-directives.js › handle`. This paragraph exists so
 * the next reader of this service does not conclude the server has an opinion.
 *
 * ── ⚠ `operator_user_id` IS `ctx.userId` AND IS NEVER A PARAMETER ────────────
 *
 * Same rule as `service-launch.ts`, and it is the entire cross-member story:
 * {@link CreateAgentDirectiveInput} has no field for an operator, so "end an
 * agent on somebody else's computer" has no spelling on this path. The ownership
 * check below is a SECOND, FRIENDLIER refusal layered on top — see
 * {@link refuseForeignTarget}.
 */

/**
 * WHAT THE CALLER ASKS FOR. ⚠ A DISCRIMINATED UNION, mirroring
 * `schema-launch.ts › AgentDirectiveCreateSchema`: a rename REQUIRES a name and
 * an end must not carry one, which the column CHECK also says at rest.
 */
export type CreateAgentDirectiveInput =
  | { kind: "end"; channel: string; agentId: string }
  /** ⚠ `name: ""` IS LEGAL AND MEANS CLEAR — back to `Agent #<id>`, the same
   *  gesture `sessions:rename` takes. A separate "unname" kind would be a second
   *  way to say one thing. */
  | { kind: "rename"; channel: string; agentId: string; name: string };

/**
 * `offline` = no row was created and nothing was asked. Identical in shape and
 * meaning to {@link import("./service-launch").CreateLaunchResult}, deliberately:
 * the MCP renders for the three verbs sit beside each other and a third envelope
 * shape would buy nothing but a branch.
 */
export type CreateAgentDirectiveResult =
  | { offline: true; directive: null }
  | { offline: false; directive: LaunchDirective };

/**
 * **THE CROSS-MEMBER REFUSAL, AND EXACTLY WHAT IT IS WORTH.**
 *
 * ⚠ **IT IS NOT THE FENCE. `operator_user_id` IS.** A directive is stamped with
 * the authenticated caller and only that caller's own machines ever claim one, so
 * naming a peer's agent id is already unreachable — that machine's registry holds
 * only its own operator's sessions and would answer `no-session`. What this check
 * buys is the SENTENCE: "that agent belongs to another member" instead of "your
 * own machine has never heard of it", two minutes later, after a claim and a
 * spawn-time lookup. **Deleting it degrades an error message; it does not open a
 * hole.** Do not let a future reader mistake it for the fence and relax the one
 * that is.
 *
 * ⚠ **AND IT ONLY EVER REFUSES ON A POSITIVE FACT.** `channel_sessions` is a
 * projection the desktop pushes, so silence means nobody reported — never that
 * the agent does not exist (`repository-agent-owner.ts` states the three cases).
 * An unknown id therefore PROCEEDS and is answered by the only authority there
 * is, the machine. Refusing on absence would break every end of an agent whose
 * machine had simply not pushed yet, which is the ordinary state seconds after a
 * launch.
 */
async function refuseForeignTarget(
  ctx: ChannelContext,
  agentId: string
): Promise<void> {
  const owner = await agentInstanceOwner(ctx.workspaceId, agentId);
  if (owner !== null && owner !== ctx.userId) {
    throw new AgentDirectiveForeignError(agentId);
  }
}

/**
 * FILE AN `end` OR `rename` DIRECTIVE.
 *
 * FOUR GATES, IN THIS ORDER, and the order is chosen the same way
 * `createLaunchDirective`'s is — cheapest first, except where a cheap gate would
 * answer the wrong question:
 *
 *  1. **THE CHANNEL MUST BE VISIBLE AND THE CALLER MUST BE A MEMBER.**
 *     `loadVisibleChannel` alone admits a non-member to a PUBLIC channel (§5),
 *     and this is not a read. ⚠ **THE CHANNEL IS REQUIRED EVEN THOUGH THE AGENT
 *     ID ALONE WOULD ADDRESS THE TARGET, AND THAT IS THE POINT**: without it this
 *     op is a bare "end agent `abcdefgh`" primitive over the whole deployment,
 *     with no room the caller had to be in first. It also means the caller got
 *     the id from somewhere it could see — `read_sessions` — rather than by
 *     guessing eight characters.
 *  2. **THE TARGET MUST NOT DEMONSTRABLY BELONG TO ANOTHER MEMBER.** See
 *     {@link refuseForeignTarget} for what that proves and what it does not.
 *  3. **PRESENCE.** {@link operatorIsOnline} — the only gate that can pass while
 *     the answer is still "no", which is why it is last.
 *
 * ⚠ **GATE 2 SITS ABOVE PRESENCE, BREAKING THE CHEAPNESS ORDER FOR THE SAME
 * REASON THE TEMPLATE GATE DOES.** `offline` is a 200 meaning "nothing was
 * asked", the ordinary answer for a closed laptop. Answering a PEER'S AGENT ID
 * with "your machine is asleep" sends the caller to fix the wrong thing and get
 * the real refusal a minute later; a foreign id is the caller's own error and is
 * answerable without anyone's machine being up.
 *
 * ⚠ **THE AGENT ID IS NOT OTHERWISE VALIDATED HERE AND CANNOT BE** — whether an
 * agent is ALIVE is knowable only on the machine running it. `service-directions
 * .ts › createAgentDirection` declines the same check for the same reason. A live
 * id that has simply not been reported yet must work; a dead one is answered
 * `no-session` by the machine.
 */
export async function createAgentDirective(
  ctx: ChannelContext,
  input: CreateAgentDirectiveInput
): Promise<CreateAgentDirectiveResult> {
  const { channel, membership } = await loadVisibleChannel(ctx, input.channel);
  if (membership === null) {
    // ⚠ NOT-FOUND-SHAPED, exactly as the launch create is: to a non-member of a
    // public channel this must read like a private channel they cannot see. A
    // distinct "you may read but not manage agents here" would be a new fact
    // about the room.
    throw new LaunchDirectiveNotFoundError(input.channel);
  }

  await refuseForeignTarget(ctx, input.agentId);

  if (!(await operatorIsOnline(ctx))) {
    return { offline: true, directive: null };
  }

  const now = Date.now();
  const row = await launchRepo.insertLaunchDirective(ctx.userId, {
    kind: input.kind,
    workspace_id: ctx.workspaceId,
    channel_id: channel.id,
    // ⚠ NO THREAD, EVER, ON THIS PATH. An agent is ended or renamed as an
    // INSTANCE; `task_id` says where a launch should WORK, and stamping one here
    // would invite a reader to think an end is scoped to a thread. The instance
    // id is the whole address.
    task_id: null,
    goal: null,
    model: null,
    template_id: null,
    template_name: null,
    target_agent_id: input.agentId,
    // ⚠ `null` ON AN END, `string` (possibly '') ON A RENAME — the column CHECK
    // enforces both directions, so an end that smuggled a name and a rename that
    // dropped one are each refused AT REST rather than reaching a machine with
    // nothing coherent to do.
    target_name: input.kind === "rename" ? input.name : null,
    // ⚠ THE LAUNCH TTL, REUSED RATHER THAN TUNED. What is being waited on is
    // identical — a claim by a machine that is either listening or not — and a
    // second liveness number on one table is how two rows written a second apart
    // come to disagree about when they died. (Contrast the DIRECTION lane, whose
    // longer TTL IS justified: it waits for a TURN, not a claim.)
    expires_at: new Date(now + LAUNCH_DIRECTIVE_TTL_MS).toISOString(),
  });
  return { offline: false, directive: toDirective(row, now) };
}
