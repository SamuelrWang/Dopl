import "server-only";
import { findWorkspaceById } from "./repository";
import { countActiveMembers } from "./repository-overview";

/**
 * 🔒 **PUBLISHING INTO A PEER'S ROOM IS A SERVER PRECONDITION, NOT A DIALOG**
 * (G16; `docs/specs/mcp-v2-architecture.md` A11).
 *
 * THE GAP THIS CLOSES. "This shares a copy into this channel — everyone here
 * will see it" (`apps/desktop-ui/src/pages/home/agent-copy.tsx › describe`) and
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
 * ⚠ **THE PREDICATE IS DELIBERATELY NARROW, AND EACH CLAUSE REMOVES A
 * POPULATION THAT HAS NO SECOND AUDIENCE.** A standard workspace publishes to
 * colleagues who chose to be there and has done so since long before this wave;
 * a SOLO container is the operator's own agent surface, where the audience is
 * one person and it is them (`knowledge/server/service-audience.ts` states the
 * same carve for the same reason). What is left is exactly the room a PEER
 * arrived in.
 *
 * ⚠ **THE FLAG IS IGNORED, NEVER REFUSED, OUTSIDE THE PREDICATE.** The MCP
 * surface refuses a stray `confirm_token` (`confirm-token.ts ›
 * refuseStrayToken`) because a token is minted per act and echoing one back
 * where none was minted is a mis-modelled surface. This is a plain boolean on
 * every create body: a client that sends it unconditionally has over-stated
 * something true, and 400ing that would break callers to punish honesty.
 */

/**
 * A publish into a shared link container arrived without `acknowledgeShared`.
 * → **400 `CONTAINER_PUBLISH_UNACKNOWLEDGED`**.
 *
 * ⚠ 400, NOT 403, AND THE DIFFERENCE IS THE REMEDY. The caller is allowed to do
 * this; the REQUEST is incomplete. A 403 tells a client to stop and tells an
 * agent to look for a permission it will not find — this one names the field
 * that finishes the call, which is the only useful next action.
 *
 * ⚠ THE MESSAGE NAMES THE ROOM AS "this channel" AND NEVER ITS NAME OR ITS
 * MEMBERS. The caller can already list both; the error does not have to be the
 * thing that says so, and an error string is spliced into surfaces that do not
 * neutralize values.
 */
export class ContainerPublishUnacknowledgedError extends Error {
  readonly code = "CONTAINER_PUBLISH_UNACKNOWLEDGED";
  constructor(noun: string) {
    super(
      `Nothing was written. Sharing this ${noun} here publishes it to everyone ` +
        `in this home channel, including the other people standing in it. ` +
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
 * workspace is not 'link'   → pass  (1 read)
 * fewer than 2 active members → pass (2 reads)
 * else                      → 400 CONTAINER_PUBLISH_UNACKNOWLEDGED
 * ```
 *
 * ⚠ **THE ORDER IS THE QUERY BUDGET**, and it is the order
 * `service-audience.ts › resolveAgentAudience` uses for the same two reads. A
 * private create pays nothing; only an unacknowledged publish pays both.
 *
 * ⚠ **`publishes` IS THE RESOLVED VALUE ON A CREATE AND THE REQUESTED ONE ON AN
 * UPDATE**, and the callers spell it, not this function. A create's visibility
 * is defaulted by the service, so the row's landing value is the only honest
 * subject; an update that does not name `visibility` is not publishing anything
 * — the row is already where it is, and asking a rename to acknowledge an
 * audience it did not change is a gate on the wrong verb.
 *
 * ⚠ **A MISSING WORKSPACE ROW PASSES.** `withWorkspaceAuth` proved an active
 * membership before this ran, so `null` means the row vanished mid-request and
 * the write underneath is about to fail on its own. Same reading, same
 * justification, as `resolveAgentAudience`'s.
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

  const workspace = await findWorkspaceById(input.workspaceId);
  // ⚠ `=== "link"`, NOT `!isStandardWorkspace(…)`. That predicate is the
  // LISTING one and its negative spelling admits every kind nobody has designed
  // yet (`workspaces/types.ts`); this asks whether the room is specifically the
  // one a peer stands in, and a future kind must not inherit a refusal written
  // before it existed. `service-audience.ts › findWorkspaceKind` states the
  // same choice for the same axis.
  if (workspace === null || workspace.kind !== "link") return;

  const members = await countActiveMembers(input.workspaceId);
  if (members < 2) return;

  throw new ContainerPublishUnacknowledgedError(input.noun);
}
