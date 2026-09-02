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
import { channelNotFound, inlineOr, isErr, resolveChannelOr } from "./channel-shared";
import { bareAgentId } from "./channel-agent-id";

/** Peer-influenced display text, neutralized — never an empty span. */
const NO_NAME = "(unnamed)";

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
const REFUSAL_SENTENCES: Record<LaunchRefusalReason, string> = {
  // ⚠ THE ONE THAT IS NOT A FAULT, AND THE ONE THAT WILL BE SEEN MOST. On an END
  // this is very often the outcome the caller wanted, reached by the agent simply
  // finishing. The sentence must not send anyone to debug it.
  "no-session":
    "no live session of yours carries that agent id on that machine. The ordinary cause is that the agent ALREADY FINISHED — for an end, that is the outcome you wanted, reached without you. Check with dopl_channel(op=\"read_sessions\"): if it is not listed, there is nothing left to end and nothing is wrong. If it IS listed, the id may be one of your operator's OTHER machines' — those are not reachable from the one that answered.",
  // ⚠ RENAME-ONLY, and the sentence says exactly what would be accepted, because
  // the caller can fix this one on its own in a single retry.
  "bad-name":
    "that machine's sanitizer refused the NAME. It takes 1-60 visible characters on ONE line; control, zero-width and bidi characters are refused rather than stripped, and an EMPTY name is legal and clears back to \"Agent #<id>\". Nothing else about the agent changed. Re-issue with a plain one-line name.",
  busy: "the machine is under load and declined FOR NOW. This one is genuinely temporary — it is reasonable to ask again in a minute or two, once, and to stop if it refuses the same way twice.",
  // ⚠ THE THREE WORDS BELOW ARE LAUNCH-SHAPED AND ARRIVE HERE ONLY AS THE
  // MACHINE'S CATCH-ALL. Their launch sentences would be actively wrong here
  // ("wait for an agent to finish" before ending one), so each says what it can
  // honestly say and stops.
  cap: "the machine answered with its concurrency word, which is not a state an end or a rename can be blocked by — treat it as the machine declining rather than as a slot problem. Check dopl_channel(op=\"read_sessions\") and ask your operator if it repeats.",
  "no-sdk":
    "that machine has NO AGENT RUNTIME available. Re-issuing will not change that. Tell your operator; it is a setup problem on their side.",
  "auth-hold":
    "the desktop is SIGNED OUT or its credential is being held, so it will act on nothing until a human signs in. Tell your operator — this needs them, not another call.",
  // ⚠ **THE COPY THAT MUST NOT BE COPIED FROM THE LAUNCH MAP.** There, `no-bridge`
  // is the operator's launch toggle being off and the advice is "ask them to turn
  // it on". THAT TOGGLE DOES NOT GATE THESE TWO VERBS, so repeating the advice
  // here would send an orchestrator to request a permission unrelated to what
  // failed — and, worse, to conclude the operator had denied it something they
  // never denied.
  "no-bridge":
    "the machine could not take the request — most often it is not watching that channel, so it has no context for the agent you named. It is NOT a permission setting: your operator's launch-over-MCP toggle governs STARTING agents and has no bearing on ending or renaming one, so do not ask for it to be turned on. Check dopl_channel(op=\"read_sessions\") for which channel that agent is actually in and name that channel instead.",
  "no-counterparty":
    "the machine answered with a word that belongs to starting an agent, not to managing one. Nothing was changed. Check dopl_channel(op=\"read_sessions\") and report it to your operator if it repeats.",
  "no-template":
    "the machine answered with a word that belongs to starting an agent, not to managing one. Nothing was changed. Check dopl_channel(op=\"read_sessions\") and report it to your operator if it repeats.",
};

function refusalSentence(reason: LaunchRefusalReason | null): string {
  if (reason === null) {
    // ⚠ Reachable only if a machine wrote a refusal with no reason, which the
    // column's own CHECK forbids. Said honestly rather than guessed at.
    return "the machine refused and gave no reason. That should not happen; report it to your operator.";
  }
  return (
    REFUSAL_SENTENCES[reason] ??
    "the machine refused for a reason this build does not recognize. Report it to your operator rather than re-issuing."
  );
}

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

/** The line a PENDING (or expired) agent directive ends on. ⚠ Says the id,
 *  because the id is the only handle the caller has left, and says NOT to
 *  re-issue. */
function pendingLines(d: LaunchDirective, verb: string): string[] {
  return [
    `The request is still PENDING — id \`${d.id}\`, and it stays answerable until ${d.expiresAt}.`,
    `⚠ A TIMEOUT IS NOT A REFUSAL. Your operator's machine may still take it; nothing has been cancelled. **DO NOT ISSUE THIS CALL AGAIN** — a second directive is a second request for the same change, and on an end you would have no way to tell which one acted.`,
    `To find out what happened: dopl_channel(op="read_sessions"). ${verb === "ended" ? "The agent disappearing from that list is the answer." : "The rename is DISPLAY-ONLY and lives on your operator's machine, so read_sessions will NOT show it — the handle is unchanged either way. Nothing here can confirm a rename landed."}`,
  ];
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
      response: ok(
        [
          `Nothing was ${input.kind === "end" ? "ended" : "renamed"} — your operator's machine is not reporting in, so there is nothing listening. **No request was filed**, so there is nothing pending and nothing to cancel.`,
          `⚠ THIS IS A HINT, NOT A VERDICT ON A PARTICULAR MACHINE. What was checked is a per-(user, workspace) presence heartbeat: it says no listener of your operator's has checked in recently. It cannot tell you WHICH of their machines is up.`,
          `Most likely the machine is asleep, closed, or signed out. ⚠ NOTE FOR AN END: an agent on a machine that is not running is not running either — there may be nothing left to stop. Ask your operator, or check dopl_channel(op="read_sessions") when they are back.`,
        ].join("\n"),
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
  const label = inlineOr(channel.name, NO_NAME);
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

  if (d.status === "done") {
    return ok(
      [
        `Agent \`${agent}\` was ENDED in **${label}**. Terminal for that session — it will not answer, post or resume.`,
        `⚠ NOTHING ELSE CHANGED. The thread it was working (if any) is untouched, and every message it posted stays in the channel attributed exactly as before. An end stops a RUNNER; it removes no history.`,
        `⚠ ITS HANDLE IS SPENT. \`@agent-${agent}\` now addresses nothing, and instance ids are not reused — if you need that work continued, launch a new agent with dopl_channel(op="launch_agent", channel="${ref}", goal=...) and carry the context over yourself.`,
        `⚠ "Ended" means THE MACHINE SAID SO. There is no second source; dopl_channel(op="read_sessions") is where you confirm it is gone.`,
      ].join("\n"),
    );
  }

  if (d.status === "refused") {
    return ok(
      [
        `Agent \`${agent}\` was NOT ended in **${label}** — your operator's machine REFUSED, and ${refusalSentence(d.refusalReason)}`,
        `⚠ A refusal is a normal answer from a machine its owner controls, not an error and not a bug in your request. Nothing is pending; there is nothing to cancel.`,
      ].join("\n"),
    );
  }

  if (d.status === "expired") {
    return ok(
      [
        `Agent \`${agent}\` was NOT ended in **${label}** — the request LAPSED before any machine answered it (id \`${d.id}\`). Most often that means the desktop went to sleep.`,
        `Nothing is pending now. dopl_channel(op="read_sessions") will show you whether that agent is still running; ask once more only if it is.`,
      ].join("\n"),
    );
  }

  const claimed = d.status === "claimed" ? ` A machine has TAKEN it, so it is likely to land shortly.` : "";
  return ok(
    [
      `No answer yet from your operator's machine about ending agent \`${agent}\` in **${label}**.${claimed}`,
      ...pendingLines(d, "ended"),
    ].join("\n"),
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
  const label = inlineOr(channel.name, NO_NAME);
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

  if (d.status === "done") {
    const head = clearing
      ? `Agent \`${agent}\`'s display name was CLEARED in **${label}** — your operator sees it as "Agent #${agent}" again.`
      : `Agent \`${agent}\` is now displayed as "${inlineOr(name, NO_NAME)}" in **${label}**.`;
    return ok(
      [
        head,
        `⚠ DISPLAY ONLY, AND ON ONE MACHINE. \`@agent-${agent}\` is unchanged and remains the ONLY address — nothing resolves an agent by its name, which is what stops a rename silently re-pointing a running instruction.`,
        `⚠ YOU WILL NOT SEE IT FROM HERE. The name is stored on your operator's desktop and reaches no server, so dopl_channel(op="read_sessions") keeps printing the id. That is correct, not a stale read — do not re-issue expecting the listing to change.`,
      ].join("\n"),
    );
  }

  if (d.status === "refused") {
    return ok(
      [
        `Agent \`${agent}\` was NOT renamed in **${label}** — your operator's machine REFUSED, and ${refusalSentence(d.refusalReason)}`,
        `⚠ Nothing about the agent changed: it is still running, still addressed as \`@agent-${agent}\`, and still carries whatever name it had.`,
      ].join("\n"),
    );
  }

  if (d.status === "expired") {
    return ok(
      [
        `Agent \`${agent}\` was NOT renamed in **${label}** — the request LAPSED before any machine answered it (id \`${d.id}\`). Most often that means the desktop went to sleep.`,
        `Nothing is pending. A rename is cosmetic and costs nothing to skip — re-issue only if the label matters to your operator.`,
      ].join("\n"),
    );
  }

  const claimed = d.status === "claimed" ? ` A machine has TAKEN it, so it is likely to land shortly.` : "";
  return ok(
    [
      `No answer yet from your operator's machine about renaming agent \`${agent}\` in **${label}**.${claimed}`,
      ...pendingLines(d, "renamed"),
    ].join("\n"),
  );
}
