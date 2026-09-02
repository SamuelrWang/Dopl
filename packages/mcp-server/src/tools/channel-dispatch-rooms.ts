/**
 * `op="rooms"` — WHAT THIS PLACE IS, and the four acts that change it.
 *
 * ⚠ **EIGHT OLD OPS, ONE DISPATCHER** (B8, 2026-09-02): `list`, `open`,
 * `invite`, `members`, `list_threads`, `set_thread_mode`, `update` and `help`
 * were eight top-level names for one question — the ROOM, rather than the
 * conversation in it. `read` answers "what was said", `status` "what is
 * running", and this answers "what is this place, and who is in it".
 *
 * ⚠ **FOUR OF THE EIGHT WRITE, AND THE GATE IS PER ACTION** (`gating.ts ›
 * WRITE_OPS` names `rooms.open`, `rooms.invite`, `rooms.thread_mode` and
 * `rooms.update`). Classifying the whole op as a write would refuse a
 * `dopl.read` token the four calls it exists to make — listing its channels
 * among them — and classifying it as a read would hand one the four that
 * change the room. Neither is a scoping; both are holes.
 *
 * ⚠ `channel-` filename prefix is REQUIRED: the parity split-scan
 * (`parity.test.ts`) and the removed-vocabulary source scan
 * (`law-scan.test.ts`) read every non-test `channel-*.ts` in this directory.
 */

import type { DoplClient } from "@dopl/client";
import { err, missingParams, ok, type ToolResponse } from "./respond";
import { CHANNEL_DOCTRINE, doctrineSection } from "./channel-doctrine";
import {
  CHANNEL_ACTIONS,
  CHANNEL_INPUT_SHAPE,
  type RoomsAction,
} from "./channel-schema";
import { opList, opListThreads, opMembers } from "./channel-ops-read";
import { opInvite, opOpen } from "./channel-ops-open";
import { opSetThreadMode } from "./channel-ops-threads";
import { opUpdate } from "./channel-ops-update";
import type { z } from "zod";
import type { ZodObject } from "zod";

/** The validated argument bag, exactly as `channel.ts`'s handler receives it. */
type ChannelArgs = z.infer<ZodObject<typeof CHANNEL_INPUT_SHAPE>>;

/**
 * True for an action this module answers. ⚠ **THE ONE PLACE THE PAIRING IS
 * CHECKED**, and it exists because `action` is ONE flat enum over two
 * vocabularies: `rooms` must not answer `launch`, and `manage` must not answer
 * `open`. The two lists are disjoint, so membership settles the pair.
 */
export function isRoomsAction(action: string): action is RoomsAction {
  return (CHANNEL_ACTIONS.rooms as readonly string[]).includes(action);
}

export async function dispatchRoomsAction(
  action: RoomsAction,
  args: ChannelArgs,
  client: DoplClient,
  selfUserId: string | null,
  isAdmin: boolean,
): Promise<ToolResponse> {
  switch (action) {
    case "list":
      return opList(client);

    // ⚠ THE DOCTRINE DOOR. Returns a CONSTANT and makes no request at all — the
    // same text as the MCP resource `dopl://doctrine/channels`, for a client
    // that lists tools and never reads resources, so the rules can never be
    // unreachable. ⚠ `section` NARROWS and never changes what is true: an
    // unknown name cannot reach here, because the schema's enum is built from
    // the same table, so there is no not-found arm to write or to get wrong.
    case "help":
      return ok(
        args.section === undefined
          ? CHANNEL_DOCTRINE
          : doctrineSection(args.section),
      );

    // ⚠ WHICH ROOM IS READ OFF THE SHAPE, NOT OFF A FLAG (C12, 2026-09-02).
    // `direct: true` was a third thing to get right beside the two arguments
    // that already said everything: a 1:1 has a recipient and no `name`, a named
    // channel has a `name` and no recipient, and the flag could contradict
    // either. Both together is the one ambiguous call, and it is REFUSED rather
    // than resolved by precedence — a caller that meant one of them cannot tell
    // which it got.
    case "open": {
      if (args.to !== undefined && args.name !== undefined) {
        return err(
          'op="rooms" action="open" takes `name` (a named channel) or `to` (a direct 1:1), never both — nothing was opened. Drop `to` to open a channel, or drop `name` to open the DM.',
        );
      }
      if (args.to !== undefined) {
        return opOpen(client, { direct: true, member: args.to });
      }
      const miss = missingParams('rooms action="open"', args, ["name"]);
      if (miss) return miss;
      return opOpen(client, {
        name: args.name as string,
        // ⚠ **THE TOPIC IS `summary` (B8).** One field carries "the one-line
        // intent" everywhere on this surface — a thread's title, a send's
        // notification line, a decision's question — and a room's topic is the
        // same sentence about a room. A second name for it was a param.
        topic: args.summary,
        visibility: args.visibility,
      });
    }

    case "invite": {
      const miss = missingParams('rooms action="invite"', args, [
        "channel",
        "to",
      ]);
      if (miss) return miss;
      return opInvite(client, args.channel as string, args.to as string);
    }

    case "members": {
      const miss = missingParams('rooms action="members"', args, ["channel"]);
      if (miss) return miss;
      // ⚠ Admin flag gates member EMAIL in the roster render.
      return opMembers(client, args.channel as string, selfUserId, isAdmin);
    }

    case "threads": {
      const miss = missingParams('rooms action="threads"', args, ["channel"]);
      if (miss) return miss;
      return opListThreads(client, args.channel as string, selfUserId);
    }

    case "thread_mode": {
      const miss = missingParams('rooms action="thread_mode"', args, [
        "channel",
        "thread",
        "mode",
      ]);
      if (miss) return miss;
      return opSetThreadMode(
        client,
        args.channel as string,
        args.thread as string,
        args.mode as "interactive" | "autonomous",
      );
    }

    // ⚠ THE INFO CARD ONLY. `name` / `topic` / `archived` are accepted by the
    // same route and are deliberately NOT routed here (Samuel's ruling Q12 (b);
    // F-346 holds the rename hole open). ⚠ `info_card` OMITTED is the READ — the
    // card is replaced whole, so a blind write clobbers.
    case "update": {
      const miss = missingParams('rooms action="update"', args, ["channel"]);
      if (miss) return miss;
      return opUpdate(client, args.channel as string, args.info_card);
    }
  }
}
