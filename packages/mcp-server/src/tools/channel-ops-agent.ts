/**
 * `dopl_channel` op="manage" action="end" / op="manage" action="rename" — **MANAGE THE OPERATOR'S OWN
 * RUNNING AGENTS** (2026-09-01, Samuel: *"I need you to build out dopl mcp being
 * able to end agents. Dopl MCP need to be able to do all that stuff"*).
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts) — a handler in an unprefixed file is invisible to the declared-
 * param drift guards.
 *
 * ── THE ONE THING EVERY LINE IN HERE HAS TO RESPECT ─────────────────────────
 *
 * **THESE OPS ASK. THEY DO NOT DO ANYTHING THEMSELVES.** Agents live in a desktop
 * main process no server can reach; what crosses the wire is a row in the SAME
 * mailbox `op="manage" action="launch"` writes, which the operator's machine polls, claims
 * and answers. `channel-ops-launch.ts` states the three consequences at length
 * and all three hold here — a refusal is a normal outcome, a timeout is not a
 * failure, and "ended" means A MACHINE SAID SO.
 *
 * ── ⚠ WHERE THESE TWO DIFFER FROM `launch_agent`, AND IT IS WORTH SAYING ────
 *
 *  1. **NO CONSENT TOGGLE APPLIES.** `launch_agent`'s `no-bridge` is the operator
 *     saying no via a per-machine setting. That setting gates LAUNCHES (and
 *     re-postures) ONLY — it does NOT gate these two verbs. An
 *     end or a rename is not refused by it and **the copy below must never tell a
 *     caller to ask for it to be turned on** — that would send an orchestrator to
 *     request a permission that has nothing to do with what failed.
 *  2. **THE COMMONEST REFUSAL IS NOT AN ERROR.** `no-session` means that agent is
 *     not running any more, and an agent that finished is the ordinary cause. For
 *     an END that is the outcome the caller wanted, reached by another route, and
 *     the sentence says so rather than reading as a fault.
 *  3. **THERE IS NOTHING TO POLL AFTERWARDS EXCEPT `status`**, which is
 *     also where the caller got the id — so every terminal sentence points back
 *     at it.
 */

import type {
  DoplClient,
  LaunchDirective,
  LaunchMessageMode,
  LaunchToolMode,
} from "@dopl/client";
// ⚠ NO `err` HERE SINCE 2026-09-18 — every refusal this file used to WRITE now lives in
// `channel-agent-target.ts` (the not-an-id arm and `foreignAgent`), so this module builds
// only `ok` fact lines and returns refusals its neighbour composed.
import { ok, apiErrorCode, isNotFound, type ToolResponse } from "./respond";
// The mailbox ops' one hold loop and one retry map (P8-07/P8-08).
import { LAUNCH_RETRY_ADVICE, holdRow } from "./channel-directive-hold";
import { channelNotFound, isErr, resolveChannelOr } from "./channel-shared";
import { agentDisplayName } from "./agent-display-name";
// ⚠ **THE TWO "WHICH AGENT IS THIS" REFUSALS ARE A NEIGHBOUR** (`channel-agent-target.ts`,
// 2026-09-18) — this file was at the §1 cap, and the seam is the one
// `channel-ops-launch-name.ts` draws for the launch lane: the STRIP plus the CHECK plus the
// sentence, in one module the four manage verbs share. `foreignAgent` moved with them because
// it answers the same question one step later ("that id is not yours").
import {
  agentTarget,
  foreignAgent,
  isAgentTargetRefusal,
} from "./channel-agent-target";
// ⚠ ONE write-result renderer, shared with post / create_thread / launch / direct.
import { factsLine, type FactValue } from "./channel-facts";

/**
 * THE THREE AGENT-MANAGEMENT KINDS AND WHAT EACH CARRIES — **one declaration,
 * shared with `channel-ops-agent-mode.ts`.**
 *
 * ⚠ IT MIRRORS `@dopl/client › AgentDirectiveCreateInput` rather than being it:
 * this is the shape {@link fileAndHold} takes, and stating it once is what lets
 * the third verb live in its own module without a second copy of the union
 * drifting from this one.
 * ⚠ **BOTH AXES ON THE `set_agent_mode` ARM ARE OPTIONAL HERE, DELIBERATELY.**
 * "At least one of them" is a REGISTRAR check (`channel.ts`) and a route check; a
 * type expressing it would be a union of three shapes for one verb, and the
 * caller-facing message would become a parse error instead of a sentence.
 */
export type AgentDirectiveKind = "end" | "rename" | "set_agent_mode";
export type AgentDirectiveInput =
  | { kind: "end"; channel: string; agentId: string }
  | { kind: "rename"; channel: string; agentId: string; name: string }
  | {
      kind: "set_agent_mode";
      channel: string;
      agentId: string;
      tools?: LaunchToolMode;
      messages?: LaunchMessageMode;
    };

/**
 * THE PENDING FACTS. ⚠ **`retry=no` IS THE ONE INSTRUCTION THAT COULD NOT BECOME
 * A BARE FACT AND DID NOT**: a second directive is a second request for the same
 * change, and on an END nothing could tell you afterwards which one acted.
 *
 * ⚠ `confirm=` NAMES THE SURFACE THAT ANSWERS, AND IT IS A MAP OVER THE KIND
 * RATHER THAN A TERNARY. That stopped being cosmetic at the THIRD verb:
 * `kind === "end" ? … : …` is correct for two kinds and silently gives a
 * RE-POSTURE the RENAME's answer for three — a conditional over a closed set is
 * the shape that goes wrong the day the set grows, failing nothing on the way.
 * ⚠ AND THE THREE ANSWERS GENUINELY DIFFER. An END is confirmable: the agent
 * disappearing from `status` is the answer. A RENAME is not — it is
 * display-only and lives on the operator's machine, so that listing keeps
 * printing the id. A POSTURE is not either, for the same reason, and it is the
 * one where believing otherwise is dangerous: an agent whose re-posture never
 * landed is still running at its old permissions.
 */
/**
 * THE PAST-TENSE WORD FOR EACH KIND, IN ONE PLACE — used by the one render that
 * still needs prose (a FOREIGN agent id, which is an error, not a fact line).
 *
 * ⚠ A MAP RATHER THAN A TERNARY, and it stopped being cosmetic at the third
 * verb: `kind === "end" ? "ended" : "renamed"` is CORRECT for two kinds and
 * silently reports a RE-POSTURE as a RENAME for three. A conditional over a
 * closed set is the shape that goes wrong the day the set grows, failing nothing
 * on the way.
 */
const VERB_PAST: Record<AgentDirectiveKind, string> = {
  end: "ended",
  rename: "renamed",
  set_agent_mode: "re-postured",
};

const PENDING_CONFIRM: Record<AgentDirectiveKind, string> = {
  end: "status",
  rename: "none",
  set_agent_mode: "none",
};

/** ⚠ TAKES THE **KIND**, NOT A DISPLAY WORD: the surface it names is a claim
 *  about what a later read can prove, and keying that off prose is how a third
 *  verb inherits the second one's answer. */
export function pendingFacts(
  d: LaunchDirective,
  kind: AgentDirectiveKind,
): Record<string, FactValue> {
  return {
    directive: d.id,
    claimed: d.status === "claimed",
    expires: d.expiresAt,
    retry: false,
    confirm: PENDING_CONFIRM[kind],
  };
}

/**
 * FILE THE DIRECTIVE AND HOLD — the half `end_agent` and `rename_agent` share.
 *
 * ⚠ THE CREATE'S TWO NON-MACHINE FAILURES ARE SORTED ON THE **CODE**, NOT THE
 * STATUS, the discipline `channel-ops-launch.ts` adopted when one call gained two
 * ways to 404. Here a 403 is unambiguous, but the 404 is not: it may be the
 * CHANNEL (unknown, or one the caller never joined) and nothing else, so it
 * renders as a channel error rather than as anything about the agent.
 */
/**
 * ⚠ EXPORTED FOR `channel-ops-agent-mode.ts` (2026-09-01), and for that ONE
 * caller. It is the whole hold protocol — file the row, poll it, give up — over
 * `channel-directive-hold.ts › holdRow`, the one hold every mailbox op shares.
 * ⚠ What is shared is the PLUMBING; every sentence a caller reads is written in
 * its own module, because the three verbs' consent stories differ.
 */
export async function fileAndHold(
  client: DoplClient,
  ref: string,
  // ⚠ THE UNION IS {@link AgentDirectiveInput}, DECLARED ABOVE AND NOT INLINED.
  // The THIRD kind rides this same hold and shares nothing else with the other
  // two (2026-09-01): its sentences, its refusal map and its consent story live
  // in `channel-ops-agent-mode.ts`, because it is the one agent verb still gated
  // by the operator's launch toggle. "Both axes optional, at least one required"
  // is enforced at the tool boundary and again by the column CHECK, never here —
  // this function files a row, it does not judge one.
  input: AgentDirectiveInput,
  waitMs: number | undefined,
): Promise<
  | { done: true; response: ToolResponse }
  | { done: false; directive: LaunchDirective }
  | { done: true; offline: true; response: ToolResponse }
> {
  let created;
  try {
    created = await client.createAgentDirective(input);
  } catch (e) {
    if (apiErrorCode(e) === "CHANNEL_AGENT_FOREIGN") {
      return {
        done: true,
        response: foreignAgent(input.agentId, VERB_PAST[input.kind]),
      };
    }
    if (isNotFound(e)) return { done: true, response: channelNotFound(ref) };
    throw e;
  }
  if (created.offline) {
    return {
      done: true,
      offline: true,
      // ⚠ `filed=no` IS THE LOAD-BEARING HALF — nothing was written, so there is
      // nothing pending and nothing to cancel, the opposite of the PENDING
      // shape. ⚠ PRESENCE IS A HINT, NOT A VERDICT: a per-(user, workspace)
      // heartbeat cannot say WHICH machine is up. The doctrine says so.
      response: ok(
        // ⚠ **THE VERB COMES FROM {@link VERB_PAST}, NOT FROM A TERNARY.** This
        // line read `input.kind === "end" ? "not ended" : "not renamed"` — the
        // exact shape `VERB_PAST` and `PENDING_CONFIRM` were both made into
        // `Record<AgentDirectiveKind, …>` maps to avoid, and their docblocks say
        // so in as many words. It was correct for two kinds and silently told a
        // `set_agent_mode` caller its POSTURE request was a RENAME. F-413.
        factsLine(`not ${VERB_PAST[input.kind]}`, {
          agent: `@agent-${input.agentId}`,
          reason: "offline",
          filed: false,
        }),
      ),
    };
  }
  return {
    done: false,
    directive: await holdRow(created.directive, (id) => client.getLaunchDirective(id), waitMs),
  };
}

/**
 * END ONE OF THE OPERATOR'S OWN RUNNING AGENTS.
 *
 * ⚠ **A STOP VERB. IT TOUCHES NO THREAD AND DELETES NO MESSAGE** — everything the
 * agent posted stays in the channel, attributed exactly as before. The sentence
 * says so, because "end" is the word an orchestrator is most likely to over-read
 * as "remove".
 * ⚠ **YOU CANNOT END YOURSELF FROM HERE AND THE QUESTION DOES NOT ARISE**: the
 * caller of this op is an EXTERNAL session, which is not a desktop agent and has
 * no instance id. The in-process twin refuses self-end because the dispatch would
 * abort the calling turn; nothing on this lane can be in that position.
 */
export async function opEndAgent(
  client: DoplClient,
  ref: string,
  agentId: string,
  opts: { waitMs?: number } = {},
): Promise<ToolResponse> {
  // ⚠ **THE TARGET IS CHECKED BEFORE THE CHANNEL LOOKUP** (S51, 2026-09-18): a refusal that
  // needs no round trip must not cost one. ⚠ STRIPPED **AND NOW VALIDATED** — the pasted
  // `@agent-<id>` form is still accepted, exactly as before; what is refused is a NAME HANDLE,
  // which `to`'s describe used to offer flatly and which nothing on this lane can resolve. It
  // used to reach the create schema and die as a bare `VALIDATION_FAILED` naming no field.
  const target = agentTarget(agentId);
  if (isAgentTargetRefusal(target)) return target;
  const agent = target.agent;

  const channel = await resolveChannelOr(client, ref);
  if (isErr(channel)) return channel;
  // ⚠ THE CHANNEL NAME IS NO LONGER RENDERED. Every result on this lane is a
  // fact line keyed on the AGENT, which is what the caller acts on; the channel
  // is the caller's own argument from this call and echoing it bought nothing.

  const filed = await fileAndHold(
    client,
    ref,
    { kind: "end", channel: channel.id, agentId: agent },
    opts.waitMs,
  );
  if (filed.done) return filed.response;
  const d = filed.directive;

  // ── THE RESULT: ONE LINE OF FACTS (T10, 2026-09-02) ──────────────────────
  //
  // ⚠ WHAT LEFT. Four paragraphs rode on every successful end: that nothing else
  // changed, that the handle is spent, that ids are never reused, and that
  // "ended" means the machine said so. All four are true of EVERY end and are in
  // `channel-doctrine.ts` under YOUR OWN AGENTS.
  //
  // ⚠ `handle=spent` IS THE ONE THAT HAD TO SURVIVE AS A FACT. Instance ids are
  // never reused, so `@agent-<id>` now addresses nothing and there is no undo and
  // no resume — an orchestrator that keeps writing that handle is talking to
  // nobody, silently, which is the failure this lane exists inside.
  if (d.status === "done") {
    return ok(
      factsLine("ended", { agent: `@agent-${agent}`, handle: "spent", filed: true }),
    );
  }

  if (d.status === "refused") {
    return ok(
      factsLine("not ended", {
        agent: `@agent-${agent}`,
        reason: d.refusalReason ?? undefined,
        // ⚠ `-` WHEN THE MACHINE NAMED NO REASON, never a guessed verdict.
        retry: d.refusalReason ? LAUNCH_RETRY_ADVICE[d.refusalReason] : undefined,
        filed: true,
      }),
    );
  }

  if (d.status === "expired") {
    // ⚠ LAPSED IS NOT REFUSED: no machine ever answered, so nothing is
    // outstanding — but check `read_sessions` before asking again, because an
    // agent that has since finished needs no end at all.
    return ok(
      factsLine("not ended", {
        agent: `@agent-${agent}`,
        directive: d.id,
        reason: "expired",
        filed: true,
      }),
    );
  }

  return ok(
    factsLine("pending", { agent: `@agent-${agent}`, ...pendingFacts(d, "end") }),
  );
}

/**
 * RENAME ONE OF THE OPERATOR'S OWN AGENTS.
 *
 * ⚠ **DISPLAY ONLY, ON ONE MACHINE, AND EVERY SENTENCE HERE HAS TO CARRY THAT.**
 * The name lives in `main/agent-names.js`'s local store; nothing resolves an agent
 * by it, no server holds it, and `read_sessions` will never show it. A caller that
 * believed otherwise would start addressing `@research` and reach nobody — the
 * exact failure `channel-session-handle.ts` documents at length for the same
 * reason.
 * ⚠ AN EMPTY `name` CLEARS, back to `Agent #<id>`. One verb, not two.
 */
export async function opRenameAgent(
  client: DoplClient,
  ref: string,
  agentId: string,
  name: string,
  opts: { waitMs?: number } = {},
): Promise<ToolResponse> {
  // ⚠ **THE SAME TARGET CHECK `opEndAgent` MAKES, AND FOR THE SAME REASON** (S51): a rename
  // addressed to a name handle reached the create schema and came back as a bare
  // `VALIDATION_FAILED`. The pasted `@agent-<id>` form is still accepted.
  const target = agentTarget(agentId);
  if (isAgentTargetRefusal(target)) return target;
  const agent = target.agent;

  const channel = await resolveChannelOr(client, ref);
  if (isErr(channel)) return channel;
  // ⚠ THE CHANNEL NAME IS NO LONGER RENDERED. Every result on this lane is a
  // fact line keyed on the AGENT, which is what the caller acts on; the channel
  // is the caller's own argument from this call and echoing it bought nothing.
  // ⚠ A SLUG IS NORMALIZED TO A DISPLAY NAME HERE — `agent-display-name.ts`, Samuel
  // 2026-09-17. It files and reports the string it measured, never the raw argument.
  const display = agentDisplayName(name);
  const clearing = display === "";

  const filed = await fileAndHold(
    client,
    ref,
    { kind: "rename", channel: channel.id, agentId: agent, name: display },
    opts.waitMs,
  );
  if (filed.done) return filed.response;
  const d = filed.directive;

  // ── THE RESULT: ONE LINE OF FACTS (T10, 2026-09-02) ──────────────────────
  //
  // ⚠ THE TWO PARAGRAPHS THAT LEFT ARE THE SAME TWO ON EVERY RENAME — that the
  // name is display-only on one machine, and that `read_sessions` keeps printing
  // the id. They are in `channel-doctrine.ts`; what stays is the pair of fields
  // that carry the SAME warning without the prose.
  //
  // ⚠ `handle=unchanged` IS NOT DECORATION. `@agent-<id>` stays the ONLY address
  // — nothing resolves an agent by its name, which is exactly what stops a
  // rename silently re-pointing a running instruction — and an orchestrator that
  // believes otherwise starts addressing a name that reaches nobody.
  // ⚠ `confirm=none` IS THE HONEST ANSWER and must not become `read_sessions`:
  // the name lives on the operator's desktop and reaches no server, so that
  // listing keeps printing the id. That is correct rather than a stale read, and
  // there is no surface here that can confirm a rename landed.
  if (d.status === "done") {
    return ok(
      factsLine("renamed", {
        agent: `@agent-${agent}`,
        // ⚠ CLEARED IS ITS OWN OUTCOME, not an empty name: the display falls
        // back to `Agent #<id>`, which is a different thing from "unnamed".
        name: clearing ? "cleared" : display,
        handle: "unchanged",
        confirm: "none",
      }),
    );
  }

  if (d.status === "refused") {
    return ok(
      factsLine("not renamed", {
        agent: `@agent-${agent}`,
        reason: d.refusalReason ?? undefined,
        retry: d.refusalReason ? LAUNCH_RETRY_ADVICE[d.refusalReason] : undefined,
        // ⚠ NOTHING ABOUT THE AGENT CHANGED — it is still running and still
        // addressed the same way. A refused rename is cosmetic, not a fault.
        agentChanged: false,
      }),
    );
  }

  if (d.status === "expired") {
    return ok(
      factsLine("not renamed", {
        agent: `@agent-${agent}`,
        directive: d.id,
        reason: "expired",
        agentChanged: false,
      }),
    );
  }

  return ok(
    factsLine("pending", { agent: `@agent-${agent}`, ...pendingFacts(d, "rename") }),
  );
}
