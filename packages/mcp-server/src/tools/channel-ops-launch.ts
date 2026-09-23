/**
 * `dopl_channel` op="manage" action="launch" — ASK THE OPERATOR'S OWN DESKTOP TO START AN
 * AGENT (Samuel's ruling, 2026-08-22: launch-over-MCP approved, with a LOCAL
 * DESKTOP TOGGLE as the consent).
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts) — a handler in an unprefixed file is invisible to the
 * declared-param drift guards.
 *
 * ── THE ONE THING EVERY LINE IN HERE HAS TO RESPECT ────────────────────────
 * **THIS OP ASKS. IT DOES NOT START ANYTHING.** Agents live in a desktop main
 * process no server can reach; what crosses the wire is a row in a mailbox that
 * the operator's machine polls, decides, and answers. Three consequences the
 * copy must carry rather than paper over:
 *   1. A REFUSAL IS A NORMAL OUTCOME, not an error — and one of the seven reasons
 *      (`no-bridge`) is the OPERATOR SAYING NO. It must never read as a fault or
 *      as something to retry.
 *   2. A TIMEOUT IS NOT A FAILURE. The directive stays pending and the machine
 *      may still take it. Re-issuing queues a SECOND agent, so the result says
 *      so in the strongest terms available.
 *   3. "launched" MEANS A MACHINE SAID SO. There is no third party to check it
 *      against, and the sentence does not pretend otherwise.
 *
 * ⚠ A DIRECTIVE IS NOT A MESSAGE (INVARIANTS §5) — no `seq`, so it can never end
 * an `await`. That is why this op holds on the ROW rather than telling the agent
 * to arm a wait.
 */

import type {
  AgentColorKey,
  DoplClient,
  LaunchMessageMode,
  LaunchRefusalReason,
  LaunchToolMode,
} from "@dopl/client";
import { ok, err, isNotFound, type ToolResponse } from "./respond";
import { channelNotFound, isErr, resolveChannelOr } from "./channel-shared";
// ⚠ ONE write-result renderer, shared with `post` / `create_thread`.
import { factsLine, postureFacts, runtimeFacts } from "./channel-facts";
// ⚠ THE COLOUR REFUSAL IS A NEIGHBOUR, not a branch in here — this file is at the §1
// cap and a refusal is prose about one server code (`channel-ops-launch-color.ts`).
import { colorTaken, freeColors } from "./channel-ops-launch-color";
// ⚠ AND SO ARE THE TWO IDENTITY REFUSALS (`channel-ops-launch-identity.ts`, 2026-09-18) —
// same seam, same reason: ONE FIELD's prose beside the op rather than inside it.
import {
  identityElsewhere,
  identityMatches,
  launchIdentityAmbiguous,
  launchIdentityNotFound,
} from "./channel-ops-launch-identity";
import { IDENTITY_AMBIGUOUS_CODE, IDENTITY_NOT_FOUND_CODE } from "./agent-shared";
import { isNameRefusal, launchName, launchedName } from "./channel-ops-launch-name";
// ⚠ AND SO IS THE GOAL CAP (`channel-ops-launch-goal.ts`, 2026-09-18, S50) — the ONE
// pre-flight this lane owns, because the cap it enforces is the launch route's alone.
import { isGoalRefusal, launchGoal } from "./channel-ops-launch-goal";
// ⚠ THE 400 CLASSIFIER IS SHARED WITH THE WRITE LANE — `opPost`'s worked example, applied
// to the create below for the same reason: a bare `VALIDATION_FAILED` names no field.
import {
  FIELD_CAPS_NOTE,
  classifyBadRequest,
  isBadRequest,
  serverDetail,
} from "./channel-errors";

/** The `code` a DoplApiError carries, or null. ⚠ Duck-typed rather than imported
 *  — the same discipline `respond.ts`'s `isNotFound` follows across the
 *  @dopl/client boundary. */
function apiErrorCode(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

/** Default and cap for the bounded hold. ⚠ Mirrors `channel-schema.ts ›
 *  wait_ms`; the schema is what an MCP client sees, this is what runs. */
const WAIT_DEFAULT_MS = 15_000;
const WAIT_CAP_MS = 30_000;

/**
 * ⚠ COARSE, AND DELIBERATELY SO. The thing being waited on is a human-scale
 * toggle plus a process spawn on another machine; polling faster buys nothing
 * and multiplies requests across every armed launch in the workspace. 1.5s is
 * the same tick the await hold uses server-side.
 */
const POLL_INTERVAL_MS = 1_500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * THE REFUSAL CONTRACT, AS SENTENCES AN AGENT CAN ACT ON.
 *
 * ⚠ **THE WORD CROSSES THE WIRE, THE SENTENCE IS WRITTEN HERE** — the same split
 * `detail` takes, and for the same two reasons: prose on the wire needs a
 * DESKTOP RELEASE to reword, and desktop-authored text rendered into an MCP
 * result is text nobody neutralized. A value outside this map cannot arrive (the
 * column CHECK and the route enum both refuse it) and is rendered as an unknown
 * reason rather than as itself.
 *
 * ⚠ EACH SENTENCE ENDS IN WHAT TO DO, because a reason with no next action gets
 * an agent to retry the same call. And the three that are TEMPORARY say so
 * differently from the three that are not — retrying `cap` in a minute is
 * sensible, retrying `no-bridge` is asking a machine to change its owner's mind.
 */
/**
 * MAY THE CALLER ASK AGAIN? — ⚠ the ONE thing a refusal is read for, kept as a
 * field where the sentence became doctrine (T10, 2026-09-02).
 *
 * ⚠ THE NINE WORDS ARE STILL THE WIRE CONTRACT and the result still names the
 * one it got (`reason=<key>`); what left is the paragraph per key, now in
 * `channel-doctrine.ts`'s WHY A LAUNCH … IS REFUSED section. `busy` is the ONLY
 * temporary refusal on the list — every other word means the answer will not
 * change — so collapsing them into a boolean would either invite a retry loop
 * against a setting nobody is going to flip, or forbid the one retry that works.
 *
 * ⚠ IT IS A `Record<LaunchRefusalReason, …>` DELIBERATELY, which is the whole
 * value of the closed enum: a tenth word cannot enter the vocabulary without
 * this map being made to account for it.
 */
const RETRY_ADVICE: Record<LaunchRefusalReason, "once" | "no"> = {
  cap: "no",
  busy: "once",
  "no-sdk": "no",
  "auth-hold": "no",
  "no-bridge": "no",
  "no-counterparty": "no",
  "no-identity": "no",
  // ⚠ NEITHER OF THESE HAS A PRODUCER ON A LAUNCH — they belong to the `end` /
  // `rename` kinds that ride the same mailbox and therefore share the enum, and
  // the column CHECK pairs `launched` with `kind='launch'`. Arriving here IS the
  // anomaly, so the answer is `no`: a caller that re-issues over a word nothing
  // could have produced re-issues forever.
  "no-session": "no",
  "bad-name": "no",
  // ⚠ `no` LIKE EVERY OTHER SETTING WORD. The answer changes when a human flips
  // one toggle, and asking again before they have is the retry loop the split
  // off `no-bridge` exists to make avoidable rather than to invite.
  "no-chain": "no",
  // ⚠ 2026-09-22: re-issue with a model that machine lists (or none) — the SAME ask never changes.
  "no-model": "no",
};


/** The line a PENDING (or expired) directive ends on. ⚠ Says the id, because the
 *  id is the only handle the agent has left, and says NOT to re-issue. */
/**
 * ASK FOR AN AGENT, then hold briefly for the answer.
 *
 * ⚠ FOUR TERMINAL SHAPES, and each one ends in a different next action:
 * OFFLINE (nothing filed), LAUNCHED (an id to address), REFUSED (one of seven
 * sentences), PENDING/EXPIRED (the id, and an instruction not to re-issue).
 */
export async function opLaunchAgent(
  client: DoplClient,
  ref: string,
  opts: {
    thread?: string;
    goal?: string;
    model?: string;
    /**
     * **WHICH RUNTIME — ASKED FOR, AND REFUSED RATHER THAN SUBSTITUTED** (2026-09-21, U9).
     *
     * ⚠ **A SEPARATE FIELD FROM `model` ABOVE, ALWAYS.** `runtime` picks the ADAPTER, `model`
     * picks a model inside it; neither is ever derived from the other. A live launch carrying
     * `model: "codex"` was accepted and started Claude Sonnet, which is the defect this closes.
     * ⚠ PASSED THROUGH UNTOUCHED, like `identity` and `color`: the roster is the operator's own
     * desktop registry and this process cannot see it. Omitted means the documented chain (the
     * channel's runtime, then that machine's default) — never a particular vendor.
     */
    runtime?: string;
    /** Identity id OR exact name. ⚠ Passed through untouched — the id/name
     *  disambiguation and the visibility check both happen server-side. */
    identity?: string;
    /** ⚠ **ASKED FOR, NEVER SET.** The operator's machine clamps each axis to
     *  that operator's own stored ceiling; omitting both is the pre-T24
     *  behaviour. Passed through untouched — this process cannot see the
     *  ceiling and must not pretend to. */
    tools?: LaunchToolMode;
    messages?: LaunchMessageMode;
    /** ⚠ REFUSED rather than clamped when the channel forbids it, which is why
     *  it is a separate field and not a third axis. Omitted is NOT `false`. */
    chain?: boolean;
    /** ⚠ **THE IDEMPOTENCY KEY, AND IT IS WHAT MAKES A TIMED-OUT LAUNCH SAFE TO
     *  RETRY** (2026-09-02, A10/G10). Passed through untouched: the server
     *  probes it against `(channel, this operator)` and returns the stored
     *  directive rather than filing a second one. */
    clientMsgId?: string;
    /** ⚠ **ASKED FOR, AND REFUSED RATHER THAN SUBSTITUTED WHEN TAKEN.** Passed through
     *  untouched — the taken set spans every member's live agents and only the server
     *  can see it. Omitted means "first free", never "no colour". */
    color?: AgentColorKey;
    /** **WHAT TO CALL THE NEW AGENT — REQUIRED** (Samuel, 2026-09-15: *"if agents are spinning
     *  up agents, they should be the ones that are naming the agent … certainly shouldn't be an
     *  agent with the id as the name."*). ⚠ OPTIONAL IN THE TYPE AND REFUSED AT RUNTIME: the
     *  argument arrives off an MCP wire as unvalidated JSON, so the type says what may ARRIVE and
     *  the refusal below is what the caller is TOLD — and only that layer can say what to pass. */
    name?: string;
    waitMs?: number;
  } = {},
): Promise<ToolResponse> {
  // ⚠ THE NAME RULE AND ITS TWO REFUSALS LIVE IN `channel-ops-launch-name.ts` (§1's cap; the
  // one-field-one-file seam `channel-ops-launch-color.ts` already draws). It answers the trimmed
  // name or the refusal to return, so this lane files the string that was actually measured.
  const named = launchName(opts.name);
  if (isNameRefusal(named)) return named;

  // ⚠ **THE GOAL CAP IS THIS LANE'S ALONE AND IS CHECKED BEFORE ANYTHING CROSSES THE WIRE**
  // (S50, 2026-09-18). `body` publishes 16000 — right for `op="send"` — and the launch route
  // enforces 2000, so an over-long goal used to come back as a bare `VALIDATION_FAILED` with
  // no field named. ⚠ IT RUNS BEFORE `resolveChannelOr`: a refusal that needs no round trip
  // must not cost one, and the channel lookup would be work done for a call that cannot land.
  const goal = launchGoal(opts.goal);
  if (isGoalRefusal(goal)) return goal;

  // ⚠ PRE-RESOLVED, unlike the hot read paths: this op is cold (one call, then a
  // hold), and the result text names the channel repeatedly. Resolving once buys
  // a neutralized display name and a clean not-found instead of an opaque 404
  // out of the create.
  const channel = await resolveChannelOr(client, ref);
  if (isErr(channel)) return channel;

  let created;
  try {
    created = await client.createLaunchDirective({
      channel: channel.id,
      threadId: opts.thread,
      // ⚠ THE MEASURED VALUE, not a re-read of `opts.goal` — `channel-ops-launch-goal.ts`
      // hands back the argument it actually bounded, the discipline `agentName` follows.
      goal: goal.goal,
      model: opts.model,
      // ⚠ PASSED THROUGH UNTOUCHED, on `identity`'s rule and for a sharper reason: the only
      // list of runtimes is the one on the operator's machine, so this process can neither
      // validate membership nor predict whether the runtime would start. What it CAN do is
      // print what came back — see the `runtime=` / `runtimeAsked=` facts below.
      runtime: opts.runtime,
      identity: opts.identity,
      // ⚠ PASSED THROUGH UNTOUCHED, exactly like `identity` above and for a
      // sharper reason: the ceiling these are clamped against lives on the
      // OPERATOR'S MACHINE, so this process cannot evaluate the request, cannot
      // predict the outcome, and must not narrate one. What it can do is print
      // what came back — see `postureLine`.
      tools: opts.tools,
      messages: opts.messages,
      chain: opts.chain,
      clientMsgId: opts.clientMsgId,
      color: opts.color,
      // ⚠ THE TRIMMED VALUE, not `opts.name` — see `channel-ops-launch-name.ts`.
      agentName: named.name,
    });
  } catch (e) {
    // ⚠ THE IDENTITY ARMS COME FIRST, AND THE DISCRIMINATOR IS THE **CODE**, NOT
    // THE STATUS. This one call now has two ways to 404 (no such channel /
    // membership, no such identity) and one to 409, and a status-only branch
    // would tell an agent its CHANNEL was wrong when it was the identity name —
    // the exact mis-narration `channel-errors.ts` exists to stop.
    // ⚠ **THE COLOUR ARM IS FIRST AMONG THE 409s AND IS DISCRIMINATED BY CODE**, the
    // same rule the identity arms below follow: two codes now share one status, and a
    // status-only branch would tell an agent its IDENTITY name was ambiguous when its
    // COLOUR was taken. ⚠ IT IS NOT A FAILURE OF THE CALL — nothing was filed, and the
    // fix is one retry with a key from the list.
    if (apiErrorCode(e) === "AGENT_COLOR_TAKEN") {
      return colorTaken(opts.color ?? "", freeColors(e));
    }
    if (apiErrorCode(e) === IDENTITY_AMBIGUOUS_CODE) {
      return launchIdentityAmbiguous(opts.identity ?? "", identityMatches(e));
    }
    if (apiErrorCode(e) === IDENTITY_NOT_FOUND_CODE) {
      return launchIdentityNotFound(opts.identity ?? "", identityElsewhere(e));
    }
    // ⚠ **AND A 400 IS CLASSIFIED RATHER THAN LEFT BARE** (S50, 2026-09-18) — `opPost`'s
    // worked example, which this lane lacked. The pre-flight above catches the one cap this
    // process knows about; every OTHER field on the create body (a malformed `thread` uuid,
    // a `model` over its own bound, a `client_msg_id` too long) still arrives as
    // `VALIDATION_FAILED`, and without an arm it rendered as a raw throw the caller could
    // only read as "the tool broke". ⚠ IT SAYS WHAT IT IS **NOT**: no directive exists, so
    // there is nothing pending and nothing to cancel, and this is not a membership,
    // identity or colour problem — the three things an agent otherwise goes and "fixes".
    if (isBadRequest(e) && classifyBadRequest(e) === "invalid_request") {
      return err(
        `No agent was requested — that launch was rejected as INVALID before any directive was filed, and **nothing is pending**. This is NOT a membership, identity or colour problem, so do not invite anyone, re-pick an identity or change \`color\` over it.${serverDetail(e)} ${FIELD_CAPS_NOTE} Shorten or fix the field that is over and ask again.`,
      );
    }
    if (isNotFound(e)) return channelNotFound(ref);
    throw e;
  }

  // ── OFFLINE: nothing was filed, and the caveat is HONEST about what presence
  //    can and cannot tell us. ────────────────────────────────────────────────
  if (created.offline) {
    // ⚠ `filed=no` IS THE LOAD-BEARING HALF. Nothing was written, so there is
    // nothing pending and nothing to cancel — the opposite of the PENDING shape
    // below, where re-issuing starts a second agent. ⚠ PRESENCE IS A HINT, NOT A
    // VERDICT: the check is a per-(user, workspace) heartbeat, so it cannot say
    // WHICH machine is up or whether launching is enabled there. `op="rooms" action="help"`
    // carries that; the fact is that no listener has checked in.
    return ok(factsLine("not launched", { reason: "offline", filed: false }));
  }

  let directive = created.directive;
  // **THE CONVERGED-RETRY FACT** (2026-09-02, A10/G10).
  //
  // ⚠ **ADDED ONLY WHEN THE ROW WAS ALREADY THERE**, by spread, so a caller that
  // sent no key sees a byte-identical result and no op grows a `retry=-` field it
  // never had. ⚠ SPREAD **LAST** on every shape below: where a `retry` verdict is
  // already printed, `existing` must win it, because "this call filed nothing" is
  // the stronger and more actionable statement — it says the id below is the
  // FIRST request's, not a second agent's.
  // ⚠ `created.existing` IS OPTIONAL ON THE WIRE: a server older than this wave
  // sends no such key, and absent correctly reads as "a row was filed".
  const converged = created.existing ? { retry: "existing" } : {};
  const waitMs = Math.min(opts.waitMs ?? WAIT_DEFAULT_MS, WAIT_CAP_MS);
  const deadline = Date.now() + waitMs;

  // ⚠ POLLS THE ROW, never an `await`: a directive is not a message, has no
  // `seq`, and can never end a message hold.
  while (
    (directive.status === "pending" || directive.status === "claimed") &&
    Date.now() < deadline
  ) {
    await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
    try {
      directive = await client.getLaunchDirective(directive.id);
    } catch {
      // ⚠ A FAILED POLL DOES NOT DESTROY THE HOLD OR THE DIRECTIVE. The request
      // is filed and the machine may still take it, so the honest ending is the
      // PENDING one — which tells the agent where to look. Throwing here would
      // report a failure over a launch that may well be running.
      break;
    }
  }

  if (directive.status === "launched" && directive.agentId) {
    // ── THE RESULT: ONE LINE OF FACTS (T10, 2026-09-02) ────────────────────
    //
    // ⚠ WHAT LEFT. Five paragraphs rode on every successful launch: the handle
    // and why the friendly name is not one, how to redirect it later, THE THREE
    // LIMITS on spending the handle, that you cannot see inside the session, and
    // that "started" means the machine said so. Every one is true of every
    // launch — they are in `channel-doctrine.ts` under YOUR OWN AGENTS, reached
    // with `op="rooms" action="help"`.
    //
    // ⚠ `idle=` IS NOT COSMETIC AND MAY NOT BE DROPPED. A directive carrying a
    // goal starts a session that RUNS it as its first instruction; one without a
    // goal registers a stand-by agent that runs nothing until a message names it
    // (`main/launch-directives.js › spawn`, `idle: !goal`). Those are different
    // outcomes and an orchestrator acts on the difference — "it is on it" vs "it
    // is parked" — so a single field covering both would have to be the weaker
    // claim, and the weaker one leaves a caller waiting on an agent that never
    // started.
    //
    // ⚠ **`name=` IS THE ADDRESS AND `agent=` IS THE RECORD (Samuel, 2026-09-15).** The NAME is
    // what a body tags now; a second "Coder" is stored `Coder-1`, so a caller that went on
    // tagging `@coder` would reach the OTHER agent. ⚠ **TWO CASES SINCE F-736 CLOSED
    // (2026-09-18), NOT THREE** (`channel-ops-launch-name.ts › launchedName`): the machine's
    // value, or `(not reported)`. The request is never echoed — the arm that did was reachable
    // only through a DTO that cannot produce it, and it published a tag nothing answers to.
    // ⚠ **THE ID FORM IS STILL PUBLISHED, UNCHANGED**: the handle that never stops working and the
    // third coordinate of every other agent op. Nothing TELLS the caller to address with it — that
    // is what `name=` is for — but withdrawing it would be a different and worse decision.
    //
    // ⚠ A FUTURE TIER ADDS FIELDS HERE, NOT PARAGRAPHS: the resolved posture and
    // chain state the desktop applied (T24) are facts about this launch and
    // belong in this record the moment the wire carries them.
    return ok(
      factsLine("launched", {
        agent: `@agent-${directive.agentId}`,
        name: launchedName(directive.appliedAgentName),
        thread: directive.threadId ?? undefined,
        identity: directive.identityName ?? undefined,
        model: directive.model ?? undefined,
        // ⚠ **WHICH RUNTIME ACTUALLY RAN, AND — WHEN THEY DIFFER — WHICH WAS ASKED FOR**
        // (2026-09-21, U9). ⚠ **ALWAYS PRINTED, INCLUDING WHEN NOTHING WAS ASKED FOR**, on
        // `postureFacts`' argument one line down: a caller that named no runtime still ran on
        // SOME vendor, and `not reported` is the only thing between an orchestrator and the
        // assumption that silence means Claude. ⚠ `runtimeAsked=` prints ONLY on a
        // disagreement, because on the ordinary launch it would be a `-` on every line.
        ...runtimeFacts(directive),
        // ⚠ `idle=yes` means STANDING BY AND RUNNING NOTHING.
        idle: !(typeof opts.goal === "string" && opts.goal.trim() !== ""),
        // ⚠ ALWAYS PRINTED, INCLUDING WHEN NOTHING WAS ASKED FOR (T24). A caller
        // that sent no posture still ran at SOME posture, and `not reported` is
        // the only thing standing between an orchestrator and the assumption
        // that silence means whatever it hoped.
        ...postureFacts(directive),
        ...converged,
      }),
    );
  }

  if (directive.status === "refused") {
    // ⚠ THE REASON IS A KEY ON THE WIRE (`LaunchRefusalReason`, seven words) and
    // is rendered AS the key. It used to be expanded into a sentence per reason
    // plus a paragraph saying a refusal is normal; the sentences are in
    // `channel-doctrine.ts` now, and the key is the half that a caller branches
    // on. ⚠ `filed=yes`: the row exists and was answered — nothing to retry.
    return ok(
      factsLine("refused", {
        reason: directive.refusalReason ?? undefined,
        // ⚠ `-` WHEN THE MACHINE NAMED NO REASON, never a guessed retry verdict.
        // The column's own CHECK forbids that row; if one arrives, the honest
        // answer is that this build cannot advise.
        retry: directive.refusalReason
          ? RETRY_ADVICE[directive.refusalReason]
          : undefined,
        filed: true,
        ...converged,
      }),
    );
  }

  if (directive.status === "expired") {
    // ⚠ LAPSED IS NOT REFUSED AND NOT PENDING: no machine ever answered, so
    // nothing is outstanding and asking once more is legitimate — which is the
    // opposite of the branch below.
    //
    // ⚠ **AND THAT PERMISSION IS NOW A FIELD, NOT A COMMENT** (S18/S56,
    // 2026-09-18). This arm carried NO `retry=` at all, on the one result line
    // where the neighbouring shapes all publish one — so the arm that MAY be
    // re-issued was the only one that said nothing about re-issuing, beside a
    // `pending` arm whose whole point is `retry=no`. An orchestrator reading
    // silence next to that either stalls on a directive nobody will ever answer
    // or re-issues on a guess, and a guess here is how a second agent is
    // started on the same work.
    // ⚠ `once`, NOT `yes`: it is `RETRY_ADVICE`'s own word for "ask again, once"
    // — the same vocabulary the refusal arm above prints, so a caller branches
    // on one set of values across the whole op.
    // ⚠ `converged` SPREADS LAST, so an `existing` verdict still wins it: "this
    // call filed nothing" is the stronger statement and names whose directive
    // the id below is.
    return ok(
      factsLine("expired", {
        directive: directive.id,
        filed: true,
        retry: "once",
        ...converged,
      }),
    );
  }

  // PENDING and CLAIMED (taken but not yet answered) both end here: the next
  // action is identical.
  //
  // ⚠ **DO NOT ISSUE THIS CALL AGAIN** is the one instruction that could not
  // become a bare fact, because the cost of getting it wrong is a SECOND agent
  // on the same work that nothing can tell apart afterwards. It survives as
  // `retry=no` — a field, not a paragraph — and the reason is in the doctrine.
  return ok(
    factsLine("pending", {
      directive: directive.id,
      claimed: directive.status === "claimed",
      expires: directive.expiresAt,
      retry: false,
      ...converged,
    }),
  );
}
