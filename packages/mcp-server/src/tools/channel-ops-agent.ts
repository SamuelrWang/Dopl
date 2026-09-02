/**
 * `dopl_channel` op="end_agent" / op="rename_agent" — **MANAGE THE OPERATOR'S OWN
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
 * mailbox `op="launch_agent"` writes, which the operator's machine polls, claims
 * and answers. `channel-ops-launch.ts` states the three consequences at length
 * and all three hold here — a refusal is a normal outcome, a timeout is not a
 * failure, and "ended" means A MACHINE SAID SO.
 *
 * ── ⚠ WHERE THESE TWO DIFFER FROM `launch_agent`, AND IT IS WORTH SAYING ────
 *
 *  1. **NO CONSENT TOGGLE APPLIES.** `launch_agent`'s `no-bridge` is the operator
 *     saying no via a per-machine setting. That setting gates LAUNCHES ONLY. An
 *     end or a rename is not refused by it and **the copy below must never tell a
 *     caller to ask for it to be turned on** — that would send an orchestrator to
 *     request a permission that has nothing to do with what failed.
 *  2. **THE COMMONEST REFUSAL IS NOT AN ERROR.** `no-session` means that agent is
 *     not running any more, and an agent that finished is the ordinary cause. For
 *     an END that is the outcome the caller wanted, reached by another route, and
 *     the sentence says so rather than reading as a fault.
 *  3. **THERE IS NOTHING TO POLL AFTERWARDS EXCEPT `read_sessions`**, which is
 *     also where the caller got the id — so every terminal sentence points back
 *     at it.
 */

import type { DoplClient, LaunchDirective, LaunchRefusalReason } from "@dopl/client";
import { ok, err, isNotFound, type ToolResponse } from "./respond";
import { channelNotFound, isErr, resolveChannelOr } from "./channel-shared";
import { bareAgentId } from "./channel-agent-id";
// ⚠ ONE write-result renderer, shared with post / create_thread / launch / direct.
import { factsLine, type FactValue } from "./channel-facts";

/** Peer-influenced display text, neutralized — never an empty span. */

/** ⚠ MIRRORS `channel-ops-launch.ts`. The schema is what an MCP client sees;
 *  these are what run. Deliberately the same numbers: three ops holding on one
 *  mailbox that disagreed about how long to wait would be three answers to one
 *  question. */
const WAIT_DEFAULT_MS = 15_000;
const WAIT_CAP_MS = 30_000;
const POLL_INTERVAL_MS = 1_500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The `code` a DoplApiError carries, or null. ⚠ Duck-typed rather than imported
 *  — the discipline `respond.ts`'s `isNotFound` follows across the @dopl/client
 *  boundary. */
function apiErrorCode(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

/**
 * THE REFUSAL CONTRACT FOR THESE TWO VERBS, AS SENTENCES AN AGENT CAN ACT ON.
 *
 * ⚠ **A SEPARATE MAP FROM THE LAUNCH ONE, OVER THE SAME NINE-WORD ENUM, AND THAT
 * IS THE POINT RATHER THAN DUPLICATION.** The wire word is shared; what it MEANS
 * TO DO NEXT is not. `cap` on a launch means "wait for a slot"; on an end it can
 * only mean the machine is in a state it cannot act from at all, and telling a
 * caller to "wait for one of the running agents to finish" before ENDING one is
 * advice that contradicts the request. Sharing the map would have made every one
 * of these sentences hedge.
 *
 * ⚠ EACH SENTENCE ENDS IN WHAT TO DO, because a reason with no next action gets
 * an agent to retry the same call.
 */
/**
 * MAY THE CALLER ASK AGAIN? — ⚠ the ONE thing a refusal is read for, kept as a
 * field where the sentence became doctrine (T10, 2026-09-02).
 *
 * ⚠ THE NINE WORDS ARE STILL THE WIRE CONTRACT and the result still renders the
 * one it got. The paragraph per word is in `channel-doctrine.ts`'s WHY A LAUNCH,
 * END, DIRECTION OR RENAME IS REFUSED section, which covers all three mailboxes
 * with ONE text — this lane, the launch lane and the direction lane overlap on
 * most of the vocabulary, and three copies of one explanation is how they drift.
 *
 * ⚠ `no-session` ON AN END IS USUALLY GOOD NEWS and the doctrine says so: the
 * agent already finished and there was nothing left to stop. That is why it is
 * `no` here rather than `once` — there is nothing to retry, not because a retry
 * would fail. ⚠ `no-bridge` is the LAUNCH toggle and does NOT gate these two
 * verbs, so arriving here on it means the machines disagree; still `no`.
 */
const RETRY_ADVICE: Record<LaunchRefusalReason, "once" | "no"> = {
  cap: "no",
  busy: "once",
  "no-sdk": "no",
  "auth-hold": "no",
  "no-bridge": "no",
  "no-counterparty": "no",
  "no-template": "no",
  "no-session": "no",
  "bad-name": "no",
};

/**
 * ⚠ **THE FOREIGN-AGENT REFUSAL IS THE ONE THIS SURFACE ANSWERS ITSELF**, before
 * any row exists — a 403 `CHANNEL_AGENT_FOREIGN` out of the create. Every other
 * outcome comes back from a machine.
 *
 * ⚠ IT NAMES THE FACT PLAINLY RATHER THAN 404-ING, and the server's error
 * docblock argues why that discloses nothing: the caller already proved
 * membership of the channel, inside which `op="members"` and `op="read_sessions"`
 * are readable anyway. A 404 here would tell an orchestrator its OWN agent had
 * vanished and send it to re-launch — the expensive wrong answer.
 *
 * ⚠ IT STAYS PROSE WHERE THE SUCCESS PATHS BECAME FACT LINES (T10, 2026-09-02),
 * and the distinction is the tier's own: a REFUSAL is not narration under a write
 * that happened, it is the answer to a call that was never made. It also has to
 * close a door — "do not look for another route" — which is an instruction, not
 * a fact about a row.
 */
function foreignAgent(agentId: string, verb: string): ToolResponse {
  return err(
    [
      `Nothing was ${verb} — agent \`${agentId}\` is ANOTHER MEMBER'S, and **no request was filed**.`,
      `You can only manage agents running on YOUR OWN operator's machine. A peer's agent appears in a channel as a handle and is not reachable from here at all — there is no permission that would change that, so do not look for another route and do not ask anyone to grant one.`,
      `dopl_channel(op="read_sessions") lists exactly the agents you CAN manage. If you meant one of yours, take the id from there.`,
    ].join("\n"),
  );
}

/**
 * THE PENDING FACTS. ⚠ **`retry=no` IS THE ONE INSTRUCTION THAT COULD NOT BECOME
 * A BARE FACT AND DID NOT**: a second directive is a second request for the same
 * change, and on an END nothing could tell you afterwards which one acted.
 *
 * ⚠ `confirm=` NAMES THE SURFACE THAT ANSWERS, and the two verbs have DIFFERENT
 * answers, which is why it is a field rather than one sentence. An END is
 * confirmable — the agent disappearing from `read_sessions` is the answer. A
 * RENAME is NOT: it is display-only and lives on the operator's machine, so
 * `read_sessions` keeps printing the id and nothing here can confirm it landed.
 * Collapsing those into one line would promise a confirmation for the rename
 * that does not exist.
 */
function pendingFacts(
  d: LaunchDirective,
  kind: "end" | "rename",
): Record<string, FactValue> {
  return {
    directive: d.id,
    claimed: d.status === "claimed",
    expires: d.expiresAt,
    retry: false,
    confirm: kind === "end" ? "read_sessions" : "none",
  };
}

/** Shared hold: poll the directive row until it settles or the deadline passes.
 *  ⚠ POLLS THE ROW, never an `await` — a directive is not a message, has no
 *  `seq`, and can never end a message hold. */
async function holdFor(
  client: DoplClient,
  directive: LaunchDirective,
  waitMs: number,
): Promise<LaunchDirective> {
  let d = directive;
  const deadline = Date.now() + Math.min(waitMs, WAIT_CAP_MS);
  while ((d.status === "pending" || d.status === "claimed") && Date.now() < deadline) {
    await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
    try {
      d = await client.getLaunchDirective(d.id);
    } catch {
      // ⚠ A FAILED POLL DESTROYS NEITHER THE HOLD NOR THE DIRECTIVE. The request
      // is filed and the machine may still take it, so the honest ending is the
      // PENDING one — which tells the caller where to look.
      break;
    }
  }
  return d;
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
async function fileAndHold(
  client: DoplClient,
  ref: string,
  input:
    | { kind: "end"; channel: string; agentId: string }
    | { kind: "rename"; channel: string; agentId: string; name: string },
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
        response: foreignAgent(
          input.agentId,
          input.kind === "end" ? "ended" : "renamed",
        ),
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
        factsLine(input.kind === "end" ? "not ended" : "not renamed", {
          agent: `@agent-${input.agentId}`,
          reason: "offline",
          filed: false,
        }),
      ),
    };
  }
  return { done: false, directive: await holdFor(client, created.directive, waitMs ?? WAIT_DEFAULT_MS) };
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
  const channel = await resolveChannelOr(client, ref);
  if (isErr(channel)) return channel;
  // ⚠ THE CHANNEL NAME IS NO LONGER RENDERED. Every result on this lane is a
  // fact line keyed on the AGENT, which is what the caller acts on; the channel
  // is the caller's own argument from this call and echoing it bought nothing.
  // ⚠ STRIPPED, NOT VALIDATED, and the shared helper is the one `direct_agent`
  // uses: `read_sessions` prints `@agent-<id>`, so that is what a model copies,
  // and refusing the pasted form would 400 a caller for doing exactly what the
  // neighbouring op taught. A value that is not an id after this is refused by the
  // create schema with a message that NAMES the field.
  const agent = bareAgentId(agentId);

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
        retry: d.refusalReason ? RETRY_ADVICE[d.refusalReason] : undefined,
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
  const channel = await resolveChannelOr(client, ref);
  if (isErr(channel)) return channel;
  // ⚠ THE CHANNEL NAME IS NO LONGER RENDERED. Every result on this lane is a
  // fact line keyed on the AGENT, which is what the caller acts on; the channel
  // is the caller's own argument from this call and echoing it bought nothing.
  const agent = bareAgentId(agentId);
  const clearing = name.trim() === "";

  const filed = await fileAndHold(
    client,
    ref,
    { kind: "rename", channel: channel.id, agentId: agent, name },
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
        name: clearing ? "cleared" : name,
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
        retry: d.refusalReason ? RETRY_ADVICE[d.refusalReason] : undefined,
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
