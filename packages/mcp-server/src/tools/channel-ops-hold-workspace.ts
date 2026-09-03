/**
 * `dopl_channel` op="read" with wait_ms WITH NO `channel` — the WORKSPACE-WIDE hold.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts).
 *
 * ⚠ **A SIBLING OF `channel-ops-hold.ts`, NOT A BRANCH INSIDE IT.** The two
 * share every CLOCK (`channel-hold-budget.ts`) and every rule about what a hold
 * may CLAIM (`channel-wake-guidance.ts`), and they deliberately do not share a
 * function: the per-channel op's whole result vocabulary is written around ONE
 * named channel — its re-arm call, its not-found, its stop rule all splice
 * `ref` — and threading an `undefined` ref through that would produce sentences
 * with a hole in them at exactly the moment an agent is deciding what to do next.
 *
 * ⚠ **ONE CURSOR IS LEGAL HERE BECAUSE `seq` IS WORKSPACE-GLOBAL AND GAPPY** —
 * the same property that makes a per-channel seq RANGE meaningless as a message
 * count. Ordering by it interleaves channels in true arrival order, so advancing
 * to the highest seq on a page means everything below it has been seen in EVERY
 * channel on the page.
 *
 * ⚠ **IT WATCHES CHANNELS THE CALLER IS A MEMBER OF, AND SAYS SO.** A PUBLIC
 * channel they never joined is NOT watched — narrower than `op="read"`, on
 * purpose (the argument is in
 * `src/features/channels/server/repository-await-workspace.ts ›
 * listMemberChannelRefs`). The result states the scope rather than leaving an
 * agent to infer it from an absence, because "no messages" and "that room was
 * never being watched" are different facts and only one of them is a reason to
 * keep waiting.
 */

import type { DoplClient, WorkspaceChannelMessage } from "@dopl/client";
import { ok, type ToolResponse } from "./respond";
// ⚠ `groupByChannel` MOVED to `channel-render.ts` on 2026-09-01, when the
// ACCOUNT-wide read needed the same grouping. It was private here; a second copy
// would be a second opinion about which channel ref a per-message remedy points
// at. See that function's docblock.
import { formatMessages, groupByChannel } from "./channel-render";
import { UNTRUSTED_BODY_HEADER } from "./channel-framing";
// ⚠ THE ONE HOLD IMPLEMENTATION — see `channel-ops-hold.ts` for the split.
import { describeFailure, runHold, wasCutShort } from "./channel-hold-loop";
// ⚠ The re-arm text branches on the caller's runtime here too, for the same
// reason it does per-channel: an unstamped caller may not be promised a wake.
import {
  waitingLine,
  workspaceHoldCall,
  workspaceHoldTimedOutLines,
} from "./channel-wake-guidance";
import { sessionBlockLines } from "./channel-session-table";

/**
 * THE ONE THING A WORKSPACE HOLD KNOWS THAT THE DOCTRINE CANNOT — ⚠ a SCOPE
 * fact, and all that is left of what was an 855-character stop rule.
 *
 * ⚠ **THE STOP RULE ITSELF MOVED (2026-09-03).** "Keep re-arming while the
 * member you addressed has spoken in the last ~30 minutes; stop when they have
 * not; no thread ever closes, so that silence is the only signal" is true of
 * both lanes and of every hold, and is now stated once in
 * `channel-doctrine.ts › waiting`, which every result points at.
 *
 * ⚠ **WHAT COULD NOT MOVE IS THE SENTENCE BELOW**, because it is not a rule
 * about waiting — it is a fact about THIS hold's scope, and it inverts how a
 * wake should be read. A per-channel hold that fires is at least about the room
 * you care about; a workspace hold that fires may be about any room you are in,
 * so an orchestrator can re-arm forever on a busy workspace while the one agent
 * it is blocked on died an hour ago.
 */
export function workspaceRearmStopRule(): string {
  return `⚠ A WORKSPACE hold wakes on ANY message in ANY channel you belong to, so a wake is not news about the ONE exchange you are blocked on — read THAT channel by name and judge liveness there, never off workspace activity.`;
}

/** The scope sentence, stated on every result. ⚠ Never omitted on a full page:
 *  an agent that sees traffic will otherwise assume it is seeing ALL traffic. */
function scopeNote(channelCount: number): string {
  if (channelCount === 0) {
    return `⚠ THIS HOLD WATCHED NOTHING: you are not a member of any channel in this workspace, so no message can ever end it. Do not re-arm — join or open a channel first (dopl_channel(op="rooms", action="list") to see what exists, op="rooms", action="open" to create one).`;
  }
  return `Scope: every channel you are a MEMBER of (${channelCount}). ⚠ A PUBLIC channel you have not joined is NOT watched by this hold, so silence here is not evidence the workspace is quiet — it is evidence YOUR rooms are. Join a channel to watch it, or hold on it by name with dopl_channel(op="read", channel=<slug>, since=…, wait_ms=<ms>).`;
}

/**
 * THE WORKSPACE-WIDE HOLD. One call holds for `holdMsFor(waitMs, runtime)` by
 * re-issuing the ~50s inner long-poll on the same cursor
 * (`channel-hold-loop.ts › runHold`).
 *
 * ⚠ Four results, never a thrown error once the hold is underway: messages,
 * timed-out, FAILED-MID-HOLD, CUT SHORT — the same four the per-channel lane
 * has, for the same reasons.
 * ⚠ NO not-found branch, because there is no ref to resolve: a caller with no
 * memberships gets a page with `channelCount: 0` and a result that says so.
 */
export async function opHoldWorkspace(
  client: DoplClient,
  since: number,
  waitMs?: number,
  selfUserId: string | null = null,
  runtime: string | null = null,
  selfSessionId: string | null = null,
): Promise<ToolResponse> {
  // ⚠ **CAPTURED IN THE POLL RATHER THAN RETURNED BY THE LOOP**, which is why
  // the loop needs no workspace-shaped result type: `channelCount` is this
  // lane's own fact, and the last poll to answer is the one that knows it.
  let channelCount = 0;
  const held = await runHold<WorkspaceChannelMessage>(
    async (args) => {
      const result = await client.awaitWorkspaceMessages(args);
      channelCount = result.channelCount;
      return result;
    },
    since,
    waitMs,
    runtime,
    selfSessionId,
  );
  const { messages, cursor, elapsedMs, budgetMs, sessions, operatorOnline } = held;
  const seconds = Math.round(elapsedMs / 1000);

  if (messages.length === 0) {
    const timedOut = `No new messages in ANY channel you belong to since seq ${cursor} — the wait timed out after about ${seconds}s with nothing arriving.`;
    // ⚠ Say what BROKE before diagnosing a platform clamp, or a transient blip is
    // misread as "the wait is not holding" and a live exchange is abandoned.
    if (held.pollError !== null) {
      return ok(
        [
          `The workspace wait ended early, after about ${seconds}s: an inner poll failed — ${describeFailure(held.pollError)}.`,
          `Nothing was missed, so re-arm before you end your turn. ${waitingLine(workspaceHoldCall(cursor), cursor)}`,
          `If the very next hold fails the same way, stop re-arming and report it to your operator.`,
          workspaceRearmStopRule(),
          ...sessionBlockLines(sessions, undefined, operatorOnline),
        ].join("\n"),
      );
    }
    if (wasCutShort(elapsedMs, budgetMs)) {
      return ok(
        [
          timedOut,
          `That hold was CUT SHORT — it asked for about ${Math.round(budgetMs / 1000)}s and returned in ${seconds}s, which usually means the platform is clamping the call (or the server is erroring instantly). A hold this short can never stay pending long enough to wake you.`,
          `Do NOT immediately re-arm — you would loop on short calls that never wake anything. Report this to your operator and check channels with dopl_channel(op="read") instead.`,
        ].join("\n"),
      );
    }
    // ⚠ The TIMEOUT is the compressed result (T03) — see
    // `channel-wake-guidance.ts › workspaceHoldTimedOutLines`. `scopeNote`
    // STAYS: it is a fact about what was watched, not doctrine, and "no
    // messages" versus "that room was never being watched" are different
    // answers. The full `workspaceRearmStopRule` is still taught where it is
    // new information — on the holds that RETURN and that FAIL.
    return ok(
      [
        timedOut,
        scopeNote(channelCount),
        ...workspaceHoldTimedOutLines(cursor, runtime),
        ...sessionBlockLines(sessions, undefined, operatorOnline),
      ].join("\n"),
    );
  }

  const groups = groupByChannel(messages);
  // ⚠ Banner moved to CHANNEL_DESCRIPTION's SECURITY paragraph (T11).
  const lines = [
    `## Workspace — ${messages.length} new message${messages.length === 1 ? "" : "s"} since seq ${cursor}, across ${groups.length} channel${groups.length === 1 ? "" : "s"}\n`,
    // ⚠ Framing FIRST — counterparty-written bodies, so the caveat must be read
    // BEFORE them, not as a footnote underneath. ⚠ IT IS NOT DUPLICATED BY THE
    // TOOL DESCRIPTION, and removing it on that belief is exactly how it was
    // lost once (2026-09-02): a description is read at connect time, a body is
    // read now, and only the second one can carry an injected line.
    `${UNTRUSTED_BODY_HEADER}\n`,
  ];
  for (const g of groups) {
    // ⚠ The channel heading names the room AND gives the `ref` to use in a
    // follow-up call, because the message lines below carry per-message remedies
    // that assume it.
    lines.push(`\n### ${g.label} — \`${g.ref}\``);
    lines.push(...formatMessages(g.messages, g.ref, selfUserId));
  }
  // ⚠ THE CURSOR IS THE MAX OVER THE WHOLE PAGE, not the last line of the last
  // group. Grouping reordered the page relative to seq, so "the last message
  // shown" is no longer the highest seq — taking it would advance the cursor
  // past messages in another group and lose them permanently, because a cursor
  // only moves forward.
  const lastSeq = messages.reduce((max, m) => (m.seq > max ? m.seq : max), messages[0].seq);
  lines.push(``, scopeNote(channelCount));
  lines.push(
    `Read the "· to ..." and "· thread ..." tags on each line first: a workspace hold is even less targeted than a channel one, so most of what wakes you is context, not a request.`,
  );
  lines.push(waitingLine(workspaceHoldCall(lastSeq), lastSeq));
  lines.push(workspaceRearmStopRule());
  lines.push(...sessionBlockLines(sessions, undefined, operatorOnline));
  return ok(lines.join("\n"));
}
