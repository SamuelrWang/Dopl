/**
 * `dopl_channel` op="launch_agent" — ASK THE OPERATOR'S OWN DESKTOP TO START AN
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
  DoplClient,
  LaunchMessageMode,
  LaunchRefusalReason,
  LaunchToolMode,
} from "@dopl/client";
import { ok, err, isNotFound, type ToolResponse } from "./respond";
import { channelNotFound, inlineOr, isErr, resolveChannelOr } from "./channel-shared";
// ⚠ ONE write-result renderer, shared with `post` / `create_thread`.
import { factsLine, postureFacts } from "./channel-facts";
// ⚠ THE TENANCY SENTENCES LIVE WITH THE OTHER PROSE (T35), and the import
// direction is ops → description because the description imports nothing from
// here. FOUR surfaces state this one rule — this file's two create-time
// refusals, `channel-doctrine.ts`'s `no-template` entry, and the home-channel
// paragraph — and four hand-written copies is how two of them end up describing
// a system the other two do not.
import { TENANCY_FIX, TENANCY_RULE } from "./channel-doctrine";

/** Peer-influenced display text, neutralized — never an empty span. */
const NO_NAME = "(unnamed)";

/** The `code` a DoplApiError carries, or null. ⚠ Duck-typed rather than imported
 *  — the same discipline `respond.ts`'s `isNotFound` follows across the
 *  @dopl/client boundary. */
function apiErrorCode(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

/** One row of the ambiguity refusal, as the server's `details.matches` carries
 *  it. ⚠ Every row already passed the CALLER's own `canSeeTemplate`, so nothing
 *  here is an oracle — it is what `GET /api/agent-templates` would have said. */
type TemplateMatch = { id: string; name: string; visibility: string };

function templateMatches(e: unknown): TemplateMatch[] {
  const details = (e as { details?: unknown } | null)?.details;
  const raw = (details as { matches?: unknown } | null)?.matches;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
    .map((m) => ({
      id: typeof m.id === "string" ? m.id : "",
      name: inlineOr(typeof m.name === "string" ? m.name : "", NO_NAME),
      visibility: typeof m.visibility === "string" ? m.visibility : "unknown",
    }))
    .filter((m) => m.id !== "");
}

/**
 * THE AMBIGUOUS-NAME REFUSAL — **it lists, and it does not pick.**
 *
 * ⚠ `agent_templates` HAS NO NAME UNIQUENESS, DELIBERATELY: a unique index
 * across a visibility boundary would leak the existence of somebody's private
 * row through a conflict error, and two people may each keep a "Researcher". So
 * two visible templates sharing a name is a LEGITIMATE state, and every natural
 * tie-break ("yours wins", "newest wins") silently starts an identity the caller
 * did not choose and reports success.
 *
 * ⚠ THE LIST IS THE WHOLE VALUE OF THE REFUSAL. "That name is ambiguous" alone
 * sends the agent to another tool to fetch ids it was already holding. Each row
 * carries the ID (what to re-issue with) and the VISIBILITY (what makes the
 * choice obvious — "the private one is mine").
 * ⚠ `isError`, because nothing was filed and there is nothing pending. An `ok`
 * result reading as a normal outcome would invite a poll for a directive that
 * does not exist.
 */
function ambiguousTemplate(ref: string, matches: TemplateMatch[]): ToolResponse {
  const label = inlineOr(ref, NO_NAME);
  if (matches.length === 0) {
    return err(
      `No agent was requested — the template name \`${label}\` matches MORE THAN ONE template you can see, and nothing was started. Template names are deliberately not unique, so this call will not guess between them. List them with the agent-templates surface, then re-issue with the template's ID instead of its name.`,
    );
  }
  return err(
    [
      `No agent was requested — the template name \`${label}\` matches ${matches.length} templates you can see, and **nothing was filed**. Template names are deliberately NOT unique (two members may each keep a "Researcher"), so this call refuses rather than picking one for you.`,
      `Re-issue with the ID of the one you meant:`,
      ...matches.map((m) => `- \`${m.id}\` — ${m.name} (${m.visibility})`),
      `⚠ Every template listed is one YOU can see. Whether the OPERATOR whose machine runs the agent can see it is a separate question, answered on their machine at start time.`,
    ].join("\n"),
  );
}

/** A template the caller holds in another tenancy of their own, as the server's
 *  `details.elsewhere` carries it. ⚠ Duck-typed across the @dopl/client
 *  boundary, the same discipline `templateMatches` and `apiErrorCode` follow. */
type TemplateElsewhere = { name: string; label: string };

function templateElsewhere(e: unknown): TemplateElsewhere | null {
  const details = (e as { details?: unknown } | null)?.details;
  const raw = (details as { elsewhere?: unknown } | null)?.elsewhere;
  if (!raw || typeof raw !== "object") return null;
  const { name, label } = raw as { name?: unknown; label?: unknown };
  if (typeof name !== "string" || typeof label !== "string") return null;
  if (name === "" || label === "") return null;
  return { name, label };
}

/**
 * THE UNRESOLVABLE-TEMPLATE REFUSAL, at CREATE time.
 *
 * ⚠ DISTINCT FROM `no-template`, WHICH IS THE SAME FACT ON THE OTHER MACHINE.
 * This one is YOUR visibility failing, before any row exists; `no-template` is
 * the OPERATOR's failing, after the request was filed. The next actions differ —
 * here you fix the name, there you share the template or drop it — so they are
 * two sentences and not one.
 * ⚠ IT DOES NOT SAY WHETHER THE TEMPLATE EXISTS. The whole read surface is
 * 404-never-403 so an id cannot be probed, and a sentence that guessed would
 * rebuild that oracle.
 *
 * ⚠ BUT IT NAMES THE TENANCY RULE, WHICH IS NOT AN ORACLE (T35). The server
 * resolves the ref against THE CHANNEL'S workspace — `ctx.workspaceId` is the
 * container (`channels/server/service-shared.ts`), and every template read is
 * keyed `(workspace_id, id)` (`agent-templates/server/repository.ts`), so
 * `canSeeTemplate` is never even reached: the row is filtered by tenancy BEFORE
 * visibility runs. That is a STANDING RULE OF THE SYSTEM, true before this call
 * and answerable from the caller's own knowledge — withholding it is what made
 * this the most-misread refusal on the surface, since an agent re-checks the
 * spelling forever for a name that was never wrong.
 *
 * ⚠ AND WHEN THE SERVER SAYS WHERE, IT SAYS WHERE. `details.elsewhere` arrives
 * ONLY for a template the caller could already list for themselves — their own
 * row, or a `workspace`-visible one, in a workspace they are a member of
 * (`agent-templates/server/service-resolve-ref.ts › classifyMissingTemplateRef`
 * is the fence and holds the argument). A stranger's private template produces
 * no `elsewhere` in any workspace, so the arm below cannot name one and the
 * bare arm still answers "no such template" and "not shared with you"
 * identically.
 */
function templateNotFound(
  ref: string,
  elsewhere: TemplateElsewhere | null,
): ToolResponse {
  if (elsewhere) {
    return err(
      [
        // ⚠ `inlineOr` ALREADY RETURNS A CODE SPAN — no backticks of our own
        // around it. Both halves are peer-authored in principle (a template
        // name, a workspace name) and neither may pose as structure.
        `No agent was requested, and **nothing was filed** — template ${inlineOr(elsewhere.name, NO_NAME)} lives in ${inlineOr(elsewhere.label, "another tenancy of yours")}, not in this channel's own container.`,
        `⚠ ${TENANCY_RULE} Owning it is not enough; it has to live here. ${TENANCY_FIX}`,
      ].join("\n"),
    );
  }
  return err(
    [
      `No agent was requested — no agent template ${inlineOr(ref, NO_NAME)} resolves in THIS CHANNEL'S container, and **nothing was filed**. Either there is no such template, or it is not shared with you; those are ONE answer here on purpose, so ids cannot be probed.`,
      `⚠ CHECK THE TENANCY BEFORE THE SPELLING. ${TENANCY_RULE} If it really should resolve here, the NAME is the other suspect — matching is exact, not fuzzy. ${TENANCY_FIX}`,
    ].join("\n"),
  );
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
  "no-template": "no",
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
    /** Template id OR exact name. ⚠ Passed through untouched — the id/name
     *  disambiguation and the visibility check both happen server-side. */
    template?: string;
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
    waitMs?: number;
  } = {},
): Promise<ToolResponse> {
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
      goal: opts.goal,
      model: opts.model,
      template: opts.template,
      // ⚠ PASSED THROUGH UNTOUCHED, exactly like `template` above and for a
      // sharper reason: the ceiling these are clamped against lives on the
      // OPERATOR'S MACHINE, so this process cannot evaluate the request, cannot
      // predict the outcome, and must not narrate one. What it can do is print
      // what came back — see `postureLine`.
      tools: opts.tools,
      messages: opts.messages,
      chain: opts.chain,
      clientMsgId: opts.clientMsgId,
    });
  } catch (e) {
    // ⚠ THE TEMPLATE ARMS COME FIRST, AND THE DISCRIMINATOR IS THE **CODE**, NOT
    // THE STATUS. This one call now has two ways to 404 (no such channel /
    // membership, no such template) and one to 409, and a status-only branch
    // would tell an agent its CHANNEL was wrong when it was the template name —
    // the exact mis-narration `channel-errors.ts` exists to stop.
    if (apiErrorCode(e) === "AGENT_TEMPLATE_AMBIGUOUS") {
      return ambiguousTemplate(opts.template ?? "", templateMatches(e));
    }
    if (apiErrorCode(e) === "AGENT_TEMPLATE_NOT_FOUND") {
      return templateNotFound(opts.template ?? "", templateElsewhere(e));
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
    // WHICH machine is up or whether launching is enabled there. `op="help"`
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
    // with `op="help"`.
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
    // ⚠ THE HANDLE IS PUBLISHED IN THE PREFIXED FORM, always. The desktop parser
    // takes both `@<id>` and `@agent-<id>`, so this is a convention question —
    // and publishing the bare form while the app tints the prefixed one is how a
    // caller writes a token the reader does not highlight.
    //
    // ⚠ A FUTURE TIER ADDS FIELDS HERE, NOT PARAGRAPHS: the resolved posture and
    // chain state the desktop applied (T24) are facts about this launch and
    // belong in this record the moment the wire carries them.
    return ok(
      factsLine("launched", {
        agent: `@agent-${directive.agentId}`,
        thread: directive.threadId ?? undefined,
        template: directive.templateName ?? undefined,
        model: directive.model ?? undefined,
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
    return ok(
      factsLine("expired", { directive: directive.id, filed: true, ...converged }),
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
