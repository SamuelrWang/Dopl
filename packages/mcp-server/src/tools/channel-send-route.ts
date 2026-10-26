/**
 * `op="send"` routed to its lane: a display, a thread open, a milestone, a decision card, a record
 * or a plain post. `channel.ts` registers the tool; this file owns which handler a send reaches.
 *
 * ⚠ THREE LANES, ONE OP, AND THE `kind` IS FIXED AT THIS SEAM rather
 * than left to the caller's spelling. `milestone` stores
 * `thread_progress`; `decision` MUST stay `kind='message'` or
 * `dopl-desktop-app/main/targeting.js › classify` drops the card and the
 * human it asks is never notified. Both delegate to `opPost` rather than
 * growing a second delivery path.
 */

import type { DoplClient } from "@dopl/client";
import type { z, ZodObject } from "zod";
import { missingParams, type ToolResponse } from "./respond";
import type { CHANNEL_INPUT_SHAPE } from "./channel-schema";
import {
  decisionRefusal,
  milestoneRefusal,
  opPost,
  recordAddressedRefusal,
  tooManyRecipientsRefusal,
  unaddressedRefusal,
} from "./channel-ops-write";
import { opCreateThread } from "./channel-ops-threads";
import { opEscalate } from "./channel-ops-escalate";
import { opShow, type ShowArgs } from "./channel-ops-show";

type ChannelArgs = z.infer<ZodObject<typeof CHANNEL_INPUT_SHAPE>>;

export async function routeSend(client: DoplClient, args: ChannelArgs, runtime: string | null): Promise<ToolResponse> {
  // ⚠ A DISPLAY IS `dopl_show` (granular), routed BEFORE the channel-required check: its
  // channel is optional (the session's), and a legacy call carries no blocks to show.
  if (args.kind === "display") return opShow(client, args as ShowArgs);
  const miss = missingParams("send", args, ["channel", "body"]);
  if (miss) return miss;
  const channel = args.channel as string;
  const body = args.body as string;

  // ⚠ `thread="new"` OPENS THE EXCHANGE, and it is checked FIRST because
  // it decides which ROUTE the send goes to. `summary` is the title —
  // one field, one meaning, and the create route's own `.min(1)` is what
  // refuses a whitespace-only one after trimming.
  // ⚠ `to` names the other party; kind="record" takes none and opens a
  // thread for nobody (the only way to open one in a one-member room).
  // Any other kind without `to` is the address-or-record refusal.
  if (args.thread === "new") {
    const missNew = missingParams('send thread="new"', args, ["summary"]);
    if (missNew) return missNew;
    const record = args.kind === "record";
    const refused = record
      ? recordAddressedRefusal(Boolean(args.to))
      : unaddressedRefusal(Boolean(args.to), false);
    if (refused) return refused;
    return opCreateThread(
      client,
      channel,
      args.summary as string,
      body,
      args.to,
      undefined,
      args.client_msg_id,
      runtime,
      undefined,
      record,
    );
  }

  // ⚠ `thread` is REQUIRED here where a plain send leaves it optional —
  // an untagged milestone groups into nothing, the one shape of this
  // call that is always a mistake. ⚠ `to` is NOT routed through: a
  // milestone marks the thread and addresses nobody.
  if (args.kind === "milestone") {
    const missM = missingParams('send kind="milestone"', args, [
      "thread",
    ]);
    if (missM) return missM;
    const oversize = milestoneRefusal(body);
    if (oversize) return oversize;
    return opPost(client, channel, body, {
      kind: "thread_progress",
      thread: args.thread as string,
      summary: args.summary,
      runtime,
      // ⚠ ITS OWN VERB. A milestone result opening `posted` would report
      // the wrong act on the one lane whose whole point is that it is
      // NOT a delivery — see `PostOptions.resultHead`.
      resultHead: "milestone",
    });
  }

  // ⚠ `summary` IS THE ISSUE AND `body` IS THE CONTEXT (B8). The card
  // used to take four dedicated params; two of them were the two fields
  // every send already has, under other names. ⚠ `to` is deliberately
  // NOT routed through: addressing a member starts THEIR agent
  // (INVARIANTS §5), and a decision exists precisely because a PERSON
  // has to decide — the @-tag in the body is the inbox mechanism and it
  // starts nobody.
  if (args.kind === "decision") {
    const missD = missingParams('send kind="decision"', args, [
      "summary",
      "options",
    ]);
    if (missD) return missD;
    const oversize = decisionRefusal(body);
    if (oversize) return oversize;
    return opEscalate(
      client,
      channel,
      {
        issue: args.summary as string,
        context: body,
        options: args.options as {
          label: string;
          consequence: string;
        }[],
        recommendation: args.recommendation ?? null,
      },
      {
        thread: args.thread,
        clientMsgId: args.client_msg_id,
        runtime,
      },
    );
  }

  // ⚠ **THE RECORD LANE, AND IT IS THE SECOND HALF OF THE ADDRESSING
  // STRUCTURE** (2026-09-18, Samuel's ruling). It stores `intent:"chat"`
  // on an ordinary `message` row — an existing concept given a name
  // rather than a new stored shape — and the server then refuses to
  // repair its address, so it wakes and feeds nobody. ⚠ `to` is REFUSED
  // here rather than ignored: the two say opposite things, and the
  // server's own 400 for the same contradiction narrates as a
  // membership problem.
  if (args.kind === "record") {
    const addressed = recordAddressedRefusal(Boolean(args.to));
    if (addressed) return addressed;
    return opPost(client, channel, body, {
      clientMsgId: args.client_msg_id,
      intent: "chat",
      summary: args.summary,
      thread: args.thread,
      runtime,
      // ⚠ ITS OWN VERB, on `milestone`'s precedent: a result opening
      // `posted` would report a delivery on the one lane whose contract
      // is that there was none.
      resultHead: "recorded",
    });
  }

  // ⚠ **A PLAIN SEND ADDRESSES SOMEBODY OR IT IS REFUSED** — the other
  // half of the same ruling. Checked AFTER the three kinds above, each
  // of which is already an address or already a post for nobody, and
  // carved out for a THREAD send, where the thread's two parties are the
  // address (INVARIANTS §5, RR1).
  const bare = unaddressedRefusal(Boolean(args.to), Boolean(args.thread));
  if (bare) return bare;
  const crowded = tooManyRecipientsRefusal(args.to);
  if (crowded) return crowded;

  return opPost(client, channel, body, {
    clientMsgId: args.client_msg_id,
    to: args.to,
    summary: args.summary,
    thread: args.thread,
    runtime,
  });
}
