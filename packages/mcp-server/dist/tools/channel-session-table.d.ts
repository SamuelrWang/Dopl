/**
 * THE SESSION TABLE — `read_sessions` and the `sessions` block on an `await`,
 * rendered as a grid (T13, 2026-09-02).
 *
 * ⚠ SPLIT OUT OF `channel-session-render.ts` AT THE 500-LINE CAP (§1), along the
 * seam that was already there: that file answers "what STATE is this session in"
 * and owns the vocabulary, the staleness window and the legend; this one answers
 * "how does a PAGE of them render". Every predicate below is imported from
 * there, so there is still exactly one definition of stale, of a model label and
 * of a coarse age.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts) and the removed-vocabulary source scan (channel-law.test.ts).
 */
import type { ChannelSessionState, ChannelSessionStateOwn } from "@dopl/client";
import { type SessionRenderOpts } from "./channel-session-render";
/** Header + alignment row for {@link sessionRow}. ⚠ Column order is the row's. */
export declare const SESSION_TABLE_HEAD: readonly string[];
/**
 * ONE session as a TABLE ROW — the grid form of {@link formatSessionLine},
 * carrying the same facts under the same rules.
 *
 * ⚠ SHARED BY BOTH SURFACES ON PURPOSE. `read_sessions` and the `sessions`
 * block on an `await` render rows from this one function, so the two can never
 * describe the same session differently —
 * `channel-session-liveness.test.ts` holds them byte-for-byte against each
 * other, and that guard is the reason the shared renderer exists.
 */
export declare function sessionRow(s: ChannelSessionState | ChannelSessionStateOwn, opts?: SessionRenderOpts): string;
/**
 * THE SESSION BLOCK AN `await` RETURNS WITH ITS RESULT — the caller's own agents
 * as of the moment the hold came back.
 *
 * ⚠ **`undefined` AND `[]` ARE DIFFERENT ANSWERS AND MUST RENDER DIFFERENTLY.**
 * `undefined` = the server did not report (an older deployment, or the read
 * failed) — say nothing at all, because a heading with no rows under it reads as
 * "you have none". `[]` = the server looked and this machine is reporting
 * nothing, which IS worth one line: it is the shape a crashed or signed-out
 * desktop produces, and an orchestrator waiting on an agent needs to see it.
 *
 * ⚠ **IT IS A BLOCK UNDER THE MESSAGES, NEVER INTERLEAVED WITH THEM.** The
 * messages above it are counterparty-authored under their own framing header;
 * splicing server narration between them would let a body's last line be read as
 * the start of this section.
 *
 * ⚠ COMPACT ON PURPOSE. This rides on EVERY returned hold, including every
 * timeout, so it is one line per session and one legend — never the full
 * `read_sessions` preamble.
 */
export declare function sessionBlockLines(sessions: readonly ChannelSessionStateOwn[] | undefined, now?: number, operatorOnline?: boolean): string[];
/**
 * ⚠ `SESSION_TELEMETRY_NOTE` USED TO LIVE HERE and rendered under EVERY
 * `read_sessions` page (~800 chars, on a call an orchestrator makes in a loop).
 * It was STANDING doctrine about the columns — the same on every page — so it
 * moved to `channel-doctrine.ts`'s READING "read_sessions" section, behind
 * `op="help"` and the `dopl://doctrine/channels` resource. The LEGEND above
 * stayed, because it decodes the cells THIS page actually contains and is
 * conditional on the page containing a hedged row.
 *
 * Its two promises are still promises and are pinned there: a MODEL is always
 * ONE unbroken token (which is what {@link shortModelLabel} exists to
 * guarantee), and an absent field was NOT REPORTED rather than zero.
 */
