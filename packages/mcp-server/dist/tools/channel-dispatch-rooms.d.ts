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
import { type ToolResponse } from "./respond";
import { CHANNEL_INPUT_SHAPE, type RoomsAction } from "./channel-schema";
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
export declare function isRoomsAction(action: string): action is RoomsAction;
export declare function dispatchRoomsAction(action: RoomsAction, args: ChannelArgs, client: DoplClient, selfUserId: string | null, isAdmin: boolean): Promise<ToolResponse>;
export {};
