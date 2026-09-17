import "server-only";
import { isSharedRoom } from "@/shared/tenancy/shared-room";
import { countActiveMembers } from "./repository-overview";

/**
 * 🔒 **PUBLISHING INTO A PEER'S ROOM IS A SERVER PRECONDITION, NOT A DIALOG**
 * (G16; `docs/specs/mcp-v2-architecture.md` A11).
 *
 * THE GAP THIS CLOSES. "…everyone here will see it" — the /home confirm step,
 * now `apps/desktop-ui/src/pages/home/agent-share.tsx › describe` (it was the
 * copy dialog's until B15 replaced the copy with a grant) — and
 * the MCP confirm-token preview (`packages/mcp-server/src/tools/
 * confirm-token.ts`) were the ONLY things standing between a caller and a row
 * published into a `kind='link'` container a second person is standing in. Both
 * live in a client. The server accepted the shared visibility from any member,
 * with no signal that anybody had been told — which is the shape Samuel's
 * standing ruling refuses: *a sentence telling an agent it is barred earns a
 * guardrail in the code.*
 *
 * WHAT THE FLAG IS, AND WHAT IT IS NOT. `acknowledgeShared: true` is the
 * caller's statement that the audience change was PUT IN FRONT OF SOMEBODY. It
 * is not an authorization — the caller already had permission, or
 * `withWorkspaceAuth`'s role floor and the feature's own write gate would have
 * refused first. Like `confirm-token.ts`'s token it buys that the act was SEEN;
 * unlike that token it is enforced by the server that owns the rows, so an
 * agent skipping the preview does not skip this.
 *
 * ⚠ **THE PREDICATE IS ONE QUESTION SINCE 2026-09-17, AND IT IS THE MEMBER
 * COUNT** (Samuel's ruling R-08; F-513). It used to ask `kind === 'link'` first,
 * on the argument that *"a standard workspace publishes to colleagues who chose
 * to be there"* — and that argument is about CONSENT TO THE ROOM, which is not
 * the thing this gate buys. The gate buys that somebody was TOLD, and a
 * two-member private channel in a standard workspace has the second audience
 * that makes telling them worth doing. **A multi-member standard workspace now
 * pays the acknowledgement it never used to**, which is the one user-visible
 * behaviour change in the ruling. What is still carved out is exactly the SOLO
 * room — the operator's own agent surface, audience of one and it is them —
 * which `@/shared/tenancy/shared-room` states once for all four readers.
 *
 * ⚠ **AND THE WORKSPACE READ WENT WITH THE KIND.** The gate cost two reads
 * (`findWorkspaceById`, then `countActiveMembers`) and the first one existed
 * ONLY to learn the kind. It is one read now, and the "a missing workspace row
 * passes" carve went with it: a vanished row counts zero members, zero is not
 * one, and an unacknowledged publish into a room nobody can count refuses. That
 * is the same direction the unreadable-count case already failed in, for the
 * same reason — *"I could not count the people in this room" must never read as
 * "there is nobody in it"* — and nothing is written on either path.
 *
 * ⚠ **THE FLAG IS IGNORED, NEVER REFUSED, OUTSIDE THE PREDICATE.** The MCP
 * surface refuses a stray `confirm_token` (`confirm-token.ts ›
 * refuseStrayToken`) because a token is minted per act and echoing one back
 * where none was minted is a mis-modelled surface. This is a plain boolean on
 * every create body: a client that sends it unconditionally has over-stated
 * something true, and 400ing that would break callers to punish honesty.
 */

/**
 * A publish into a SHARED room — any container with a second member in it —
 * arrived without `acknowledgeShared`.
 * → **400 `CONTAINER_PUBLISH_UNACKNOWLEDGED`**.
 *
 * ⚠ 400, NOT 403, AND THE DIFFERENCE IS THE REMEDY. The caller is allowed to do
 * this; the REQUEST is incomplete. A 403 tells a client to stop and tells an
 * agent to look for a permission it will not find — this one names the field
 * that finishes the call, which is the only useful next action.
 *
 * ⚠ THE MESSAGE NAMES NEITHER THE ROOM, ITS NAME, NOR ITS MEMBERS. The caller
 * can already list all three; the error does not have to be the thing that says
 * so, and an error string is spliced into surfaces that do not neutralize
 * values.
 *
 * ⚠ **AND IT STOPPED SAYING "home channel" ON 2026-09-17** (R-08). The gate had
 * one population and the copy could name it; it has every multi-member
 * container now, so a sentence that says "home channel" is simply wrong to the
 * member of a standard workspace who is reading it. "here" is the only word
 * that is true of all of them, and `containerKind`'s three labels are what a
 * surface uses when it wants to be specific.
 */
export class ContainerPublishUnacknowledgedError extends Error {
  readonly code = "CONTAINER_PUBLISH_UNACKNOWLEDGED";
  constructor(noun: string) {
    super(
      `Nothing was written. Sharing this ${noun} here publishes it to everyone ` +
        `else who is standing here, not just to you. ` +
        `Re-issue the same call with \`acknowledgeShared: true\` to confirm ` +
        `you mean to share it with them.`
    );
    this.name = "ContainerPublishUnacknowledgedError";
  }
}

/**
 * THE PRECONDITION. Call it after the write gate and before the row write, in
 * every create/update path that can land a resource at its SHARED visibility.
 *
 * ```
 * not publishing            → pass  (0 reads)
 * acknowledged              → pass  (0 reads)
 * exactly 1 active member   → pass  (1 read)
 * else                      → 400 CONTAINER_PUBLISH_UNACKNOWLEDGED
 * ```
 *
 * ⚠ **THE ORDER IS THE QUERY BUDGET.** A private create pays nothing; only a
 * publish that named no acknowledgement pays the one count.
 *
 * ⚠ **`publishes` IS THE RESOLVED VALUE ON A CREATE AND THE REQUESTED ONE ON AN
 * UPDATE**, and the callers spell it, not this function. A create's visibility
 * is defaulted by the service, so the row's landing value is the only honest
 * subject; an update that does not name `visibility` is not publishing anything
 * — the row is already where it is, and asking a rename to acknowledge an
 * audience it did not change is a gate on the wrong verb.
 *
 * ⚠ **AN UNREADABLE MEMBER COUNT DOES NOT PASS** — `countActiveMembers` THROWS
 * on a database error rather than answering a number, so the request fails and
 * nothing is written. That is the only direction this may fail: "I could not
 * count the people in this room" must never read as "there is nobody in it".
 */
export async function assertSharedPublishAcknowledged(input: {
  workspaceId: string;
  /** Is this call landing the row at its SHARED visibility? */
  publishes: boolean;
  /** The caller's `acknowledgeShared` flag, as it arrived. */
  acknowledged: boolean | undefined;
  /** What the operator-facing sentence calls the thing — "agent", "knowledge base". */
  noun: string;
}): Promise<void> {
  if (!input.publishes) return;
  if (input.acknowledged === true) return;

  // 🔒 THE ONE QUESTION (R-08, 2026-09-17). No kind term: a room with a second
  // person in it is shared whether that room is a link container, a standard
  // workspace or a kind nobody has designed yet. `isSharedRoom` also states the
  // unknown rule — an uncountable room is SHARED, never empty.
  const members = await countActiveMembers(input.workspaceId);
  if (!isSharedRoom(members)) return;

  throw new ContainerPublishUnacknowledgedError(input.noun);
}
