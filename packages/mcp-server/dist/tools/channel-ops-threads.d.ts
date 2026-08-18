/**
 * `dopl_channel` THREAD op handlers: create_thread / close_thread /
 * set_thread_mode. ⚠ `channel-` filename prefix required by the parity
 * split-scan (parity.test.ts).
 *
 * ⚠ BOUNDARY: wire/storage name `task` == domain name `thread`.
 *
 * ⚠ Every string below is server NARRATION, outside untrusted framing. What is
 * peer-controlled:
 *   - `ch.name` — creator-typed, and `resolveChannelOr` resolves PUBLIC channels
 *     the caller was never invited to. 120 chars, NO charset rule, so newlines
 *     are possible. Neutralized at every site.
 *   - `thread.title` — typed by whoever OPENED the thread (200 chars, interior
 *     newlines allowed), frequently NOT the caller since a close is permitted to
 *     the thread's TARGET. Hence header AND code span on that path.
 *   - `member.label` — already render-safe: `resolveMemberOr` neutralizes at the
 *     source (`memberLabel` in channel-shared.ts). Do not re-wrap.
 */
import type { DoplClient, ThreadMode, ThreadOutcome } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare function opCreateThread(client: DoplClient, channelRef: string, title: string, body: string, to: string, mode?: ThreadMode, clientMsgId?: string, runtime?: string | null, handoff?: boolean): Promise<ToolResponse>;
/**
 * ⚠ `close_thread` IS NOT AN AGENT'S OP. A close settles the SHARED thread for
 * BOTH members: "the work looks done" and "I am finished with this exchange"
 * are DIFFERENT judgments, and only the human makes the second.
 *
 * ⚠ ANSWERED, NOT REMOVED — the op stays in the enum so an agent trained on the
 * old surface gets this sentence instead of a zod "invalid enum value" at the
 * moment it most needs telling what to do instead. The real gate is the
 * server's `ThreadCloseIsHumanOnlyError`, not this.
 */
export declare function closeThreadIsHumansToMake(): ToolResponse;
/**
 * PROPOSE a close — the agent's terminal act on a thread, and the only one it
 * has (see {@link closeThreadIsHumansToMake}).
 *
 * ⚠ Proposing is allowed to the thread's CREATOR **or its TARGET**, so the
 * common shape is a peer's thread and a peer's 200-char newline-tolerant TITLE
 * rendered as our own narration. So: title is one inline code span (a value,
 * never structure), and {@link UNTRUSTED_THREAD_HEADER} comes FIRST.
 */
export declare function opProposeClose(client: DoplClient, channelRef: string, threadId: string, outcome: ThreadOutcome, summary?: string): Promise<ToolResponse>;
/**
 * Set a thread's mode. Title neutralized as everywhere else, but ⚠ NO untrusted
 * header on purpose: the route allows `set_mode` to the thread's CREATOR only,
 * so a success means the caller typed the title — the header would frame a
 * string against its own author. The span stays anyway: a tool must not depend
 * on a remote authorization check for a LOCAL rendering property.
 */
export declare function opSetThreadMode(client: DoplClient, channelRef: string, threadId: string, mode: ThreadMode): Promise<ToolResponse>;
