import "server-only";
import type { ChannelMessageCreateInput } from "../schema";
import { ChannelLifecycleKindForbiddenError } from "./errors";
import type { ChannelContext } from "./service-shared";

/**
 * P0-2 (2026-08-04) — WHO MAY POST A LIFECYCLE MARKER, and the server-internal
 * options that answer it. Split out of `service-writes.ts` at the §2 500-line cap
 * when the guard landed, on its own seam rather than an arbitrary one: this file
 * answers "may this caller make this STATEMENT", while `service-writes.ts` is the
 * write itself and `service-writes-metadata.ts` is what the write stores.
 *
 * See {@link ChannelLifecycleKindForbiddenError} for the incident.
 */

/**
 * The three kinds that STATE A RUNTIME FACT — a session started, finished, or
 * failed — and are therefore not an agent's to post. `task_progress` is absent
 * on purpose: it claims nothing about a lifecycle, its body is the one `task_*`
 * body a renderer actually shows (`splitSessionEntries`), and it is the
 * deliberate milestone lane.
 */
export const LIFECYCLE_KINDS: ReadonlySet<string> = new Set([
  "task_started",
  "task_finished",
  "task_failed",
]);

/**
 * Options only a SERVER-INTERNAL caller may pass. Not part of
 * `ChannelMessageCreateInput` and not parsed from any request body, which is
 * exactly what makes it a seam: a route hands `postMessage` the caller's parsed
 * input and nothing else, so no HTTP caller can set these.
 */
export interface PostMessageOptions {
  /**
   * Post a LIFECYCLE kind on behalf of the server itself. The ONE caller is the
   * close route's echo (`service-tasks-lifecycle.closeTask`), which writes the
   * `task_finished` / `task_failed` marker that tells the other member's card
   * the thread ended.
   *
   * ⚠ **ITS ORIGINAL MOTIVATING CASE IS UNREACHABLE, AND STAYED UNREACHABLE
   * THROUGH C-26 (re-checked 2026-08-08).** This block used to say the close echo
   * "is raised from a request that may well carry an agent token (an MCP-initiated
   * close on the human lane), so identity alone cannot tell it apart". That has
   * been false since DECISION 2 the same week: `closeTask` opens with
   * `if (ctx.source === "agent") throw new ThreadCloseIsHumanOnlyError()`, ahead of
   * every lookup, so the only caller of this flag can never hold an agent ctx and
   * the guard below would have returned early on `ctx.source !== "agent"` anyway.
   * **The 2026-08-08 REOPEN echo did NOT restore the lane**, and that was a
   * deliberate choice rather than an oversight: reopen IS agent-reachable (no
   * source check, the PATCH route is not `sessionOnly`), but its echo posts
   * `task_progress` — not one of {@link LIFECYCLE_KINDS} — so it passes the guard
   * on its own merits and asks for no exemption. If a future server-internal
   * caller genuinely needs a lifecycle KIND from an agent-ctx request, this is
   * still the seam for it; until then the flag is a NO-OP in practice and the
   * value it carries is documentary — it states at the call site that the post is
   * the server speaking, which is what keeps the rule from being re-derived from
   * identity.
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
