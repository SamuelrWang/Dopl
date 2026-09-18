import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { isUuid } from "@/shared/lib/id/uuid";
import type { KnowledgeContext } from "../types";
import {
  countActiveWorkspaceMembers,
  findWorkspaceKind,
  listChannelIdsForWorkspace,
  listGrantedBaseIdsForChannels,
} from "./repository-audience";

/**
 * The agent audience ceiling: an agent acting inside a link container with a
 * peer in it may read only the bases the operator granted into one of that
 * container's channels. Applied at the foundational lookups in
 * `service-bases.ts`, because every other knowledge read composes one of them.
 *
 * It is a fence rather than a tripwire because every input is a DB fact read on
 * the service client — nothing here is decided by a header, a prompt or a tool
 * description. It only ever closes: three of the four branches answer
 * `unrestricted`, so no branch can make a base reachable that was not.
 *
 * The solo case is deliberately untouched: with no peer there is no second
 * audience to bound. Consequence (ruling 2): a private ungranted base in the
 * container is invisible to the operator's own agent in a shared channel until
 * it is granted `agent_only`.
 *
 * It bounds future reads, never context already in the window (INVARIANTS §11) —
 * a channel that gains a peer tightens at the next tool call, which is why the
 * bound claim parks the container's live sessions (ruling 5).
 */

/**
 * What one agent may reach in one workspace. `unrestricted` carries no set — a
 * separate shape rather than a boolean beside a set, so a caller cannot read an
 * empty set as "unrestricted" or an unrestricted answer as "reaches nothing".
 */
export type AgentAudience =
  | { readonly kind: "unrestricted" }
  | {
      readonly kind: "granted";
      /** Base ids carrying a grant (either level) on one of {@link channelIds}. */
      readonly baseIds: ReadonlySet<string>;
      /** The channel set the grants were read from, after any narrowing. */
      readonly channelIds: readonly string[];
    };

const UNRESTRICTED: AgentAudience = { kind: "unrestricted" };

/**
 * Resolve the ceiling for one request.
 *
 * ```
 * ctx.source !== "agent"     → unrestricted   (humans are unaffected, full stop)
 * workspace.kind !== 'link'  → unrestricted   (standard workspaces unchanged)
 * active members <= 1        → unrestricted   (SOLO — today's behaviour)
 * else                       → granted        (grant row or 404)
 * ```
 *
 * The order is the query budget: a human costs zero extra reads, a
 * standard-workspace agent one, and only an agent inside a shared container pays
 * the full four. `listBases` runs on every knowledge page load.
 *
 * An unreadable member count fails closed — `null` is treated as "not solo" and
 * takes the narrowed branch.
 *
 * A missing workspace row answers `unrestricted`: `withWorkspaceAuth` already
 * proved an active membership before this runs, so `null` means the row vanished
 * mid-request and every read underneath answers nothing anyway.
 */
export async function resolveAgentAudience(
  ctx: KnowledgeContext
): Promise<AgentAudience> {
  if (ctx.source !== "agent") return UNRESTRICTED;

  const db = supabaseAdmin();
  const kind = await findWorkspaceKind(db, ctx.workspaceId);
  if (kind !== "link") return UNRESTRICTED;

  const memberCount = await countActiveWorkspaceMembers(db, ctx.workspaceId);
  if (memberCount !== null && memberCount <= 1) return UNRESTRICTED;

  const containerChannelIds = await listChannelIdsForWorkspace(
    db,
    ctx.workspaceId
  );
  const channelIds = narrowToSessionChannel(containerChannelIds, ctx.sessionId);
  // No container argument (F-662): `channelIds` came from this container and is
  // the fence; a grant row is filed under the resource's container, so naming
  // the caller's would refuse the cross-container lend.
  const baseIds = await listGrantedBaseIdsForChannels(db, channelIds);
  return { kind: "granted", baseIds: new Set(baseIds), channelIds };
}

/** May this audience reach this base? `unrestricted` admits everything. */
export function audienceAdmits(
  audience: AgentAudience,
  baseId: string
): boolean {
  return audience.kind === "unrestricted" || audience.baseIds.has(baseId);
}

/**
 * F-327-proofing (§4.3). The ceiling takes the SET of the container's channels,
 * because nothing enforces one channel per container. An `X-Dopl-Session-Id`
 * shaped `<channelId>:<tail>` may narrow that set to one channel, but only if
 * the id it names is already in the set; anything else is ignored entirely and
 * the unnarrowed set stands.
 *
 * The header is forgeable, and safe here only because of the direction of
 * travel: the set is computed from DB facts before the header is read, every id
 * it can select was already in that set, and selecting one can only remove
 * grants. The worst a forged value achieves is a self-inflicted 404. Do not
 * resolve the named channel against the database instead — that would turn the
 * header into an addressing input. The membership test against
 * `containerChannelIds` is the fence.
 *
 * The uuid test is a shape guard, not a fence: deleting it leaves
 * `service-audience.test.ts` green. It stays because another client's opaque
 * session handle can carry a colon without naming a channel.
 */
function narrowToSessionChannel(
  containerChannelIds: string[],
  sessionId: string | null | undefined
): string[] {
  if (typeof sessionId !== "string") return containerChannelIds;
  const head = sessionId.split(":")[0];
  if (!head || !isUuid(head)) return containerChannelIds;
  return containerChannelIds.includes(head) ? [head] : containerChannelIds;
}
