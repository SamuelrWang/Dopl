/**
 * `dopl_channel` THREAD op handlers: create_thread / set_thread_mode.
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts).
 *
 * ⚠ BOUNDARY: wire/storage name `task` == domain name `thread`.
 *
 * ⚠ Every string below is server NARRATION, outside untrusted framing. What is
 * peer-controlled:
 *   - `ch.name` — creator-typed, and `resolveChannelOr` resolves PUBLIC channels
 *     the caller was never invited to. 120 chars, NO charset rule, so newlines
 *     are possible. Neutralized at every site.
 *   - `thread.title` — typed by whoever OPENED the thread (200 chars, interior
 *     newlines allowed), and NOT necessarily the caller on every path. Hence
 *     header AND code span wherever it is rendered.
 *   - `member.label` — already render-safe: `resolveMemberOr` neutralizes at the
 *     source (`memberLabel` in channel-shared.ts). Do not re-wrap.
 */
import type { DoplClient, ThreadMode } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare function opCreateThread(client: DoplClient, channelRef: string, title: string, body: string, to: string, mode?: ThreadMode, clientMsgId?: string, runtime?: string | null, handoff?: boolean): Promise<ToolResponse>;
/**
 * ⚠ TWO OPS ENDED HERE with thread closing (wiring plan Phase 4, 2026-08-18):
 *
 *  - `closeThreadIsHumansToMake()` — the teaching refusal for `close_thread`.
 *    It was ANSWERED rather than removed from the enum, so an agent trained on
 *    the old surface got a sentence telling it what to do instead of a zod
 *    "invalid enum value". That trade only pays while there IS something to do
 *    instead; there is not, and the words themselves now teach a feature that
 *    does not exist, so the op left the enum too.
 *  - `opProposeClose()` — the agent's terminal act, a marked non-terminal
 *    `task_progress` its operator confirmed. Nothing to confirm.
 *
 * The rendering rules they demonstrated are still the file's: a peer-typed TITLE
 * goes in one inline code span with `channel-render.ts`'s
 * `UNTRUSTED_THREAD_HEADER` FIRST, and a returned cursor is STATED from the
 * server's own seq, never guessed. ⚠ Nothing left here renders a title the
 * caller did not just type, so the header has no site in this file today.
 */
/**
 * Set a thread's mode. Title neutralized as everywhere else, but ⚠ NO untrusted
 * header on purpose: the route allows `set_mode` to the thread's CREATOR only,
 * so a success means the caller typed the title — the header would frame a
 * string against its own author. The span stays anyway: a tool must not depend
 * on a remote authorization check for a LOCAL rendering property.
 */
export declare function opSetThreadMode(client: DoplClient, channelRef: string, threadId: string, mode: ThreadMode): Promise<ToolResponse>;
