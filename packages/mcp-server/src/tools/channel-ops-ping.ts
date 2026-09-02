import type { ChannelPing, DoplClient, PingKind } from "@dopl/client";
import { ok, err, type ToolResponse } from "./respond";
import { isNotFound } from "./respond";
import { channelNotFound, isErr, resolveChannelOr, inlineOr } from "./channel-shared";
import { neutralizeInline } from "./narration";
// ⚠ THE SHARED STRIPPER — it moved to its own leaf module on 2026-09-01 when a
// fourth op needed it. ONE definition: a copy drifts, and the lane that drifts
// sends `@agent-` to a column CHECK that refuses it.
import { bareAgentId } from "./channel-agent-id";
import { classifyBadRequest, isBadRequest, serverDetail } from "./channel-errors";
import { UNTRUSTED_BODY_HEADER } from "./channel-framing";

/**
 * THE "NEEDS YOU" SIGNAL — `op="ping"` and `op="pings"` (2026-09-01,
 * `docs/specs/needs-you-ping.md`).
 *
 * ⚠ **A PING IS NOT A POST AND MUST NEVER BECOME ONE.** It reaches ONE recipient,
 * it does not fan out to the room, it cannot end an `await`, and its `seq` is its
 * own cursor space. That is why it exists: an agent that FINISHED had no
 * instrument at all — an unaddressed post starts nobody (the loop brake), and an
 * addressed one shouts at a whole channel and triggers a machine.
 *
 * 🔒 **THERE IS NO ARGUMENT FOR WHOSE MACHINE.** The two self-scoped recipient
 * forms resolve to the authenticated caller's own operator, server-side, and that
 * absence is the whole loop brake on this lane: you cannot ping another member's
 * agent because there is nothing to say it with. Asserted in `channel-ping.test.ts`.
 */

/** ⚠ MIRRORS `MAX_PING_BODY` in `src/features/channels/constants.ts` and the
 *  column CHECK. Restated rather than imported for `channel-ops-escalate.ts`'s
 *  reason: the schema's copy is what an MCP client validates against, and THIS
 *  copy is what the refusal SENTENCE is built from. `channel-schema-caps.test.ts`
 *  is where the two are held equal. */
const MAX_PING_BODY = 600;

const NO_NAME = "(unnamed)";

/** What a ping row's recipient means, as one phrase a reader can act on. ⚠ The
 *  KEY crosses the wire, the SENTENCE is written here — `channel-ops-direct.ts ›
 *  REFUSAL_SENTENCES`' split, for the same reason. */
const NEXT_STEP: Record<string, string> = {
  desktop:
    "It is now in your operator's own external session's inbox — the one holding a ping wait open — so it arrives there without them asking for it.",
  agent:
    "If that agent is live on this channel, this WOKE it. If it is not, nothing was woken and the ping stands in the inbox — which is the honest outcome, not a failure.",
  member:
    'It is in that person\'s "Needs you" inbox. ⚠ Unlike an addressed post it did NOT trigger their machine and started no agent — it waits to be read, which is the point of sending one.',
};

/** ⚠ THE ONE PLACE THE THREE RECIPIENT FORMS ARE COUNTED. Zero is a signal with
 *  nowhere to go and two would make the server pick — and a silently-dropped
 *  address is the invisible-delivery failure this surface refuses everywhere.
 *  The count is IN the sentence: a caller that sent two cannot otherwise tell
 *  which one would have been honoured. */
function recipientOr(opts: {
  to?: string;
  toDesktop?: boolean;
  agentId?: string;
}): { to?: string; toDesktop?: true; agentId?: string } | ToolResponse {
  const given = [
    opts.to !== undefined && opts.to !== "",
    opts.toDesktop === true,
    opts.agentId !== undefined && opts.agentId !== "",
  ].filter(Boolean).length;
  if (given === 0) {
    return err(
      'op="ping" needs exactly one recipient and got none. Pick the one that matches who has to act: to_desktop=true reaches YOUR OWN operator\'s external session, agent_id="<handle>" reaches one of your own operator\'s running agents, to="<member>" reaches another person on this channel.',
    );
  }
  if (given > 1) {
    return err(
      `op="ping" takes exactly one recipient and got ${given}. Send to_desktop, agent_id or to — never more than one, because there is no rule for which of them would win.`,
    );
  }
  if (opts.toDesktop === true) return { toDesktop: true };
  if (opts.agentId !== undefined && opts.agentId !== "") {
    return { agentId: bareAgentId(opts.agentId) };
  }
  return { to: opts.to };
}

/**
 * SEND ONE PING.
 *
 * The canonical write-op order — pre-call refusals, resolve, call, classify 4xx,
 * render — and the body cap is checked BEFORE any round-trip so "nothing was
 * sent" is trivially true rather than confusable with a delivery failure.
 */
export async function opPing(
  client: DoplClient,
  channelRef: string,
  kind: PingKind,
  body: string,
  opts: { to?: string; toDesktop?: boolean; agentId?: string; thread?: string },
): Promise<ToolResponse> {
  if (body.length > MAX_PING_BODY) {
    return err(
      `A ping body is capped at ${MAX_PING_BODY} characters and yours is ${body.length}. That bound is the point of the op: a ping is a SIGNAL, and the thread you point at is where the report goes. Post the detail with op="post" (thread=<id>), then ping one line pointing at it.`,
    );
  }
  const recipient = recipientOr(opts);
  if ("content" in recipient) return recipient;

  // ⚠ PRE-RESOLVED, like the direct and launch ops and unlike the hot read
  // paths: this op is cold — one call, no hold — and the result names the
  // channel back to the caller.
  const channel = await resolveChannelOr(client, channelRef);
  if (isErr(channel)) return channel;
  const label = inlineOr(channel.name, NO_NAME);

  let ping: ChannelPing;
  try {
    ping = await client.createPing({
      channel: channel.id,
      kind,
      body,
      ...(opts.thread === undefined ? {} : { threadId: opts.thread }),
      ...recipient,
    });
  } catch (e) {
    if (isNotFound(e)) return channelNotFound(channelRef);
    if (isBadRequest(e)) {
      // ⚠ READ OFF THE ERROR CODE, never guessed from the status — the doctrine
      // `channel-errors.ts` states. An unrecognized 400 falls through to the
      // server's own neutralized detail rather than to a confident wrong reason.
      if (classifyBadRequest(e) === "addressee_not_member") {
        return err(
          `Nobody by that reference is on ${label}. A ping's to= names a MEMBER of the channel — check dopl_channel(op="members", channel="${channelRef}") — or, if you meant your own operator's side, send to_desktop=true instead.`,
        );
      }
      return err(`That ping was refused${serverDetail(e)}`);
    }
    throw e;
  }

  const next =
    NEXT_STEP[ping.recipientKind] ??
    "It is filed and waiting to be read.";
  return ok(
    [
      `Pinged ${label} — ${ping.kind}, ping seq ${ping.seq}.`,
      "",
      next,
      "",
      // ⚠ SAY WHAT A PING IS NOT, here rather than only in the description: a
      // tool RESULT is read at the moment the model picks its next action, so it
      // outvotes the description (INVARIANTS §10). The failure this prevents is
      // an agent pinging repeatedly because it expected a reply to arrive.
      "⚠ A ping is not a message: it is in NO transcript, it will never come back on an op=\"await\", and nothing replies to it. If you need an answer, the answer comes as a normal message on the channel — keep awaiting there.",
      `⚠ ping seq ${ping.seq} is a PING cursor and is not a message seq. Never pass it to op="read" or op="await".`,
    ].join("\n"),
  );
}

/** One inbox row. ⚠ Bodies are counterparty-written, so every one is
 *  neutralized — a body that spanned lines could otherwise fake a row. */
function formatPing(p: ChannelPing): string {
  const where = inlineOr(p.channelSlug, p.channelId);
  const from =
    p.senderAgentId === null ? "a member" : `@agent-${p.senderAgentId}`;
  const thread = p.threadId === null ? "" : ` · thread ${p.threadId}`;
  return `- [${p.kind}] seq ${p.seq} · #${where} · from ${from} · ${p.createdAt}${thread}\n    ${neutralizeInline(p.body)}`;
}

/**
 * READ THE INBOX — what was sent TO ME.
 *
 * 🔒 RECIPIENT-SCOPED AT THE SERVER, and there is deliberately no argument for
 * whose inbox: a ping targets one person, and a read that could answer for
 * somebody else would make the whole surface a worse transcript.
 */
export async function opReadPings(
  client: DoplClient,
  opts: { since?: number; limit?: number } = {},
): Promise<ToolResponse> {
  const pings = await client.listPings({
    ...(opts.since === undefined ? {} : { since: opts.since }),
    ...(opts.limit === undefined ? {} : { limit: opts.limit }),
  });

  const cursorNote =
    pings.length === 0
      ? // ⚠ AN EMPTY PAGE MUST NOT MOVE THE CURSOR. Re-arming on a fabricated
        // seq is how a reader silently skips the next arrival.
        `Nothing new${opts.since === undefined ? "" : ` after ping seq ${opts.since}`}. Re-read with the SAME since.`
      : `Next: read again with since=${pings[pings.length - 1].seq}.`;

  return ok(
    [
      `## Your pings — ${pings.length} ${pings.length === 1 ? "signal" : "signals"}\n`,
      // ⚠ FRAMING FIRST, never as a footnote: the bodies below are written by
      // other members' agents and must be read as data before they are read.
      `${UNTRUSTED_BODY_HEADER}\n`,
      ...(pings.length === 0 ? [] : pings.map(formatPing)),
      "",
      cursorNote,
      '⚠ These seqs are a PING cursor, separate from message seqs. A ping is in no transcript, so op="read" and op="await" will never show you one — this op is the only place they exist.',
    ].join("\n"),
  );
}
