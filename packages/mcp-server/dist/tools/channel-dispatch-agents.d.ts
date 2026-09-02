/**
 * `op="manage"` — THE FIVE ACTIONS THAT ASK THE OPERATOR'S OWN MACHINE TO DO
 * SOMETHING: `launch`, `end`, `rename`, `posture` and `direct`.
 *
 * ⚠ SPLIT OUT OF `channel.ts` ON 2026-09-01 and kept split by the collapse (B8,
 * 2026-09-02), because the seam is not arithmetic: these five are the ops that
 * reach a MACHINE rather than a room. Each files a directive and holds for an
 * answer, each can come back `refused` out of one closed vocabulary, and no
 * other op on this tool reads that vocabulary at all. ⚠ `read_directions` is NOT
 * here any more — reading the mailbox is `op="status"`, beside the sessions it
 * belongs to; this module is the WRITE half of that lane and nothing else.
 *
 * 🔒 **IT TAKES `args` AND `client` AND NOTHING ELSE, AND THAT IS THE FENCE
 * RESTATED RATHER THAN A CONVENIENCE.** None of the five reads the caller
 * identity, the runtime stamp, the admin flag or the container lock: a manage
 * action reaches the caller's OWN operator BY CONSTRUCTION, because the server
 * stamps the authenticated caller and there is no argument on this lane that
 * could name anybody else. ⚠ Adding a parameter here is how that stops being
 * true, so a widening needs the argument for why, in writing.
 *
 * ⚠ THE ACTION UNION IS NARROWED BY THE CALLER, so this switch is exhaustive
 * over exactly five words and needs no `default`. `channel.ts`'s own switch is
 * exhaustive over the op union in the same way, which is what proves both
 * handlers always return.
 *
 * ⚠ `channel-` filename prefix is REQUIRED: the parity split-scan
 * (`parity.test.ts`) and the removed-vocabulary source scan
 * (`channel-law.test.ts`, `law-scan.test.ts`) read every non-test `channel-*.ts`
 * in this directory.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
import type { z } from "zod";
import type { ZodObject } from "zod";
import { CHANNEL_INPUT_SHAPE, type ManageAction } from "./channel-schema";
/** The validated argument bag, exactly as `channel.ts`'s handler receives it. */
type ChannelArgs = z.infer<ZodObject<typeof CHANNEL_INPUT_SHAPE>>;
/**
 * True for an action this module answers. ⚠ **THE ONE PLACE THE PAIRING IS
 * CHECKED**, and it exists because `action` is ONE flat enum over two
 * vocabularies: `manage` must not answer `open`, and `rooms` must not answer
 * `launch`. The two lists are disjoint, so membership settles the pair.
 */
export declare function isManageAction(action: string): action is ManageAction;
export declare function dispatchManageAction(action: ManageAction, args: ChannelArgs, client: DoplClient): Promise<ToolResponse>;
export {};
