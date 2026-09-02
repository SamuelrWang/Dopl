/**
 * THE `dopl_status` TABLE — one terse block for an orchestrator's check-in.
 *
 * ⚠ **THE BUDGET IS THE FEATURE.** This replaces ~10 tool calls, and it is worth
 * having only if the answer fits in a glance: **ONE line per channel**, one per
 * live session, one per item waiting on the caller. Ten quiet channels are ~14
 * lines including the header and the legend. A paragraph added here is a
 * paragraph on every check-in of every run — the verbosity this whole wave
 * exists to delete. `status-render.test.ts` pins the budget.
 *
 * ⚠ **NULL IS UNKNOWN, NEVER ZERO** — the same rule
 * `channel-session-render.ts`'s header states, applied to a count. `unread:
 * null` means NO CURSOR WAS GIVEN, and it renders as "no cursor", never as "0
 * new". A number nobody asked for is a measurement nobody took.
 *
 * ⚠ **EVERY MEMBER-TYPED STRING GOES THROUGH THE ONE NEUTRALIZER.** Channel
 * names, author names and message previews are all VALUES spliced into lines WE
 * wrote (INVARIANTS §10), and the preview is a fragment of somebody's message
 * body. The framing header is emitted FIRST, above the content it frames.
 */
import type { AccountStatus } from "@dopl/client";
/**
 * THE WHOLE ANSWER, as lines.
 *
 * ⚠ `now` is taken ONCE for the page. Calling `Date.now()` per session line lets
 * two rows pushed in the same instant land on either side of the staleness
 * window and render in different tenses, which reads as a fact about them —
 * `channel-ops-read.ts › opReadSessions` states the same rule.
 */
export declare function statusLines(status: AccountStatus, now?: number): string[];
