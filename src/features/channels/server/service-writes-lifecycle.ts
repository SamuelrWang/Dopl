import "server-only";
import type { ChannelMessageCreateInput } from "../schema";
import { ChannelLifecycleKindForbiddenError } from "./errors";
import type { ChannelContext } from "./service-shared";

/**
 * WHO MAY POST A LIFECYCLE MARKER, and the server-internal options that answer
 * it. This file answers "may this caller make this STATEMENT";
 * `service-writes.ts` is the write, `service-writes-metadata.ts` is what it
 * stores. See {@link ChannelLifecycleKindForbiddenError}.
 */

/**
 * The three kinds that STATE A RUNTIME FACT — session started / finished /
 * failed — and are therefore not an agent's to post. ⚠ `task_progress` is absent
 * on purpose: it claims nothing about a lifecycle, its body is the one `task_*`
 * body a renderer shows (`splitSessionEntries`), and it is the milestone lane.
 */
export const LIFECYCLE_KINDS: ReadonlySet<string> = new Set([
  "task_started",
  "task_finished",
  "task_failed",
]);

/**
 * Options only a SERVER-INTERNAL caller may pass. ⚠ Not part of
 * `ChannelMessageCreateInput` and not parsed from any request body — a route
 * hands `postMessage` the caller's parsed input and nothing else, so no HTTP
 * caller can set these.
 */
export interface PostMessageOptions {
  /**
   * Post a LIFECYCLE kind on behalf of the server itself. The ONE caller is the
   * close route's echo (`service-tasks-lifecycle.closeTask`).
   *
   * ⚠ IN PRACTICE A NO-OP, and deliberately kept anyway. `closeTask` opens with
   * `if (ctx.source === "agent") throw new ThreadCloseIsHumanOnlyError()` ahead
   * of every lookup, so this flag's only caller can never hold an agent ctx and
   * the guard would return early regardless. The REOPEN echo does not restore
   * the lane either: it posts `task_progress`, not one of
   * {@link LIFECYCLE_KINDS}, so it passes the guard on its own merits.
   *
   * The value is DOCUMENTARY — it states at the CALL SITE that the post is the
   * server speaking, which is what stops the rule being re-derived from
   * identity. It remains the seam if a server-internal caller ever genuinely
   * needs a lifecycle KIND from an agent-ctx request.
   */
  internalLifecycle?: boolean;
  /**
   * Stamp this post as a CLOSE PROPOSAL carrying that outcome (DECISION 2). The
   * one caller is `service-tasks-propose.proposeTaskClose`. Reserved rather than
   * caller-settable because the marker is what raises a one-click "close this
   * thread?" prompt in front of a human.
   */
  closeProposal?: "completed" | "failed";
  /**
   * Stamp this post as the REOPEN ECHO (C-26). The one caller is
   * `service-tasks-lifecycle.reopenTask`. Reserved rather than caller-settable
   * because the marker says a settled exchange is LIVE AGAIN on the other
   * member's screen, and `channel_tasks` is in no realtime table set — so a
   * forged one would show a live thread the server still considers closed.
   */
  reopened?: boolean;
  /**
   * SPAWN-WITH-HANDOFF (rollback §3.5). Stamp the reserved `metadata.handoff`
   * flag on this post's stored metadata. The one caller is
   * `service-tasks.createTask` (via `postOpeningMessage`), which forwards the
   * validated `TaskCreateInput.handoff` boolean. Reserved on the same terms as
   * the runtime stamp: the desktop reads it to decide whether to OPEN A WINDOW,
   * so a caller that could set it in raw metadata could make its own post
   * masquerade as a declared handoff. It is stamped only onto a post that
   * carries a thread tag the poster is entitled to (`resolvePostMetadata`).
   */
  handoff?: boolean;
}

/**
 * P0-2 — THE AUTHORITATIVE HALF OF "AN AGENT WRITES PROSE, NOT LIFECYCLE".
 *
 * Refuses `task_started` / `task_finished` / `task_failed` from an AGENT-TOKEN
 * caller. The MCP tool refuses the same three before the call is made
 * (`channel-ops-write.ts`), which is the fast, teaching feedback; this is the
 * one that holds when something posts straight at the route.
 *
 * WHY IDENTITY AND NOT THE KIND ALONE — the seam, confirmed rather than assumed:
 *   - MCP `op="post"` reaches `/api/channels/[id]/messages` on a BEARER agent
 *     token, so `with-auth.ts` sets `agentTokenId` and `buildChannelContext`
 *     resolves `source: "agent"`. That is the lane being closed.
 *   - The DESKTOP RUNTIME's own lifecycle echoes (`main/session-window.js`
 *     onLaunched/onEnded → `channel-post.postTaskEvent`) go through
 *     `listener-io.apiFetch`, which authenticates with the Electron session's
 *     SUPABASE COOKIES — no agent token, `source: "user"` — and declare
 *     `authorKind:"agent"` in the body. They are untouched.
 *   - The web app posts on cookies too, same answer.
 *   - The CLOSE ECHO was named as the one real overlap. IT IS NOT ONE — the
 *     close refuses an agent ctx outright, so its `internalLifecycle` exemption
 *     is documentary rather than load-bearing. See {@link PostMessageOptions}.
 *   - The REOPEN ECHO (C-26) is agent-reachable and deliberately does NOT use the
 *     exemption: it posts `task_progress`, which is not a lifecycle kind, so an
 *     agent-triggered reopen writes its marker through the ordinary lane. That is
 *     the shape to copy — earn the pass, do not ask for one.
 *
 * Placed beside `assertChatIsUnaddressed` and for the same reason: both must
 * precede the idempotency short-circuit, so a refused post is refused on the
 * retry too rather than being replayed out of storage.
 */
export function assertLifecycleKindIsServerOwned(
  ctx: ChannelContext,
  input: ChannelMessageCreateInput,
  opts: PostMessageOptions
): void {
  if (opts.internalLifecycle) return;
  if (ctx.source !== "agent") return;
  const kind = input.kind;
  if (kind && LIFECYCLE_KINDS.has(kind)) {
    throw new ChannelLifecycleKindForbiddenError(kind);
  }
}
