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
 * body a renderer shows, and it is the milestone lane. (⚠ The reader that used
 * to say so, `splitSessionEntries`, was deleted with the session card in wiring
 * plan Phase 5, 2026-08-18; the body is still rendered — INVARIANTS §5.)
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
   * Post a LIFECYCLE kind on behalf of the server itself.
   *
   * ⚠ NO CALLER TODAY. Its one caller was the close route's echo
   * (`service-tasks-lifecycle.ts › closeTask`), DELETED with thread closing
   * (wiring plan Phase 4, 2026-08-18). It was already documentary before that:
   * `closeTask` refused an agent ctx ahead of every lookup, so the flag could
   * never be the thing that let a post through.
   *
   * KEPT ANYWAY, AND NOT AS A LEFTOVER. It is the declared SEAM for "this post
   * is the server speaking", stated at the call site rather than re-derived from
   * identity — the shape any future server-internal lifecycle post must use.
   * `service-writes-lifecycle-guard.test.ts` pins that it exempts the call
   * OPTION and never a caller's `metadata` key of the same name.
   */
  internalLifecycle?: boolean;
  /**
   * ⚠ TWO OPTIONS ENDED HERE with thread closing (Phase 4, 2026-08-18):
   * `closeProposal` (stamped the close-proposal prompt keys for the deleted
   * `service-tasks-propose.ts`) and `reopened` (stamped `threadReopened` for the
   * deleted `reopenTask`). Both were reserved because the marker they wrote
   * changed how the OTHER member's card read; neither has a renderer left.
   */
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
  /**
   * REQUEST FAN-OUT GROUP. Stamp the reserved `metadata.fanoutGroup` on this
   * post, so the N opening messages of one fanned-out request can be rendered
   * as ONE card. The one caller is `service-tasks-fanout.ts › createTaskFanOut`
   * (through `service-tasks.ts › createTask`), which DERIVES the id server-side
   * — see `fanoutGroupId` there.
   *
   * Reserved on the handoff stamp's terms: the group id decides which card a
   * thread renders inside, so a caller able to set it in raw metadata could
   * splice its own thread into somebody else's request card. Stamped only onto
   * a post carrying a thread tag the poster is entitled to
   * (`resolvePostMetadata`).
   */
  fanoutGroupId?: string;
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
 *   - The CLOSE ECHO was named as the one real overlap. It never was one (the
 *     close refused an agent ctx outright), and it is GONE — thread closing was
 *     removed in the wiring plan's Phase 4 (2026-08-18), so
 *     `internalLifecycle` now has no caller at all. See
 *     {@link PostMessageOptions}.
 *   - The reopen echo that went with it deliberately did NOT use the exemption:
 *     it posted `task_progress`, not a lifecycle kind, so it passed the guard on
 *     its own merits. That is still the shape to copy — earn the pass, do not
 *     ask for one.
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
