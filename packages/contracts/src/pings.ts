/**
 * THE "NEEDS YOU" PING'S TWO CLOSED SETS (2026-09-01,
 * `docs/specs/needs-you-ping.md`), stated ONCE for all three trees.
 *
 * ⚠ Moved here verbatim on 2026-09-02 from `src/features/channels/types-ping.ts`,
 * which had a byte-equal twin in `packages/dopl-client/src/ping-types.ts` and no
 * script between them. Both re-export from here now.
 */

/**
 * WHAT AN AGENT IS SAYING — **exactly three words, and the closed set is the
 * contract all three trees code against.**
 *
 *  - `done`     — the work is finished. This is the one Samuel's escalation cards
 *                 were missing: an agent that ended had no way to say so.
 *  - `question` — it needs an answer to continue. It is NOT an `escalate`: an
 *                 escalation offers OPTIONS a human presses. A question ping says
 *                 "come look", and the thread is where the question lives.
 *  - `blocked`  — it cannot continue and is not asking a question — a credential,
 *                 a dependency, a decision elsewhere.
 *
 * ⚠ A FOURTH KIND IS A SCHEMA CHANGE IN THREE TREES, deliberately: the column
 * carries the same CHECK and the desktop carries its own copy, so an unknown value
 * cannot be stored and cannot reach a render as raw text.
 */
export type PingKind = "done" | "question" | "blocked";

/**
 * WHOSE INBOX — stamped by the service from WHICH argument the caller used, never
 * sent by a caller.
 *
 *  - `member`  — another member of this channel. The ONE form that names somebody
 *                else, and it is fenced like a post: the sender must be a MEMBER
 *                of the channel (membership, not readability) and so must the
 *                recipient.
 *  - `desktop` — the sender's OWN operator's external Desktop Agent — the session
 *                that holds `/api/pings/await` open.
 *  - `agent`   — one named agent session on the sender's OWN operator's machine.
 *
 * 🔒 **`desktop` AND `agent` STAMP `ctx.userId` AND TAKE NO OPERATOR ARGUMENT.**
 * That absence is `direct_agent`'s authorization story reused verbatim, and it is
 * the whole of the loop brake here: **an agent can never ping another member's
 * agent**, because there is no field with which to say so.
 */
export type PingRecipientKind = "member" | "agent" | "desktop";

