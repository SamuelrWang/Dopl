import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { isUuid } from "@/shared/lib/id/uuid";
import { channelScopeAllowedForKind } from "@/shared/tenancy/channel-scope";
import { isSharedRoom } from "@/shared/tenancy/shared-room";
import type { WorkspaceKind } from "@/features/workspaces/types";
import type { KnowledgeContext } from "../types";
import {
  countActiveWorkspaceMembers,
  findWorkspaceKind,
  listChannelIdsForWorkspace,
  listGrantedBaseIdsForChannels,
} from "./repository-audience";

/**
 * The agent audience ceiling: an agent acting inside a CHANNEL-SCOPED container
 * with a second audience in it may read only the bases the operator granted into
 * one of that container's channels. Applied at the foundational lookups in
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
 * 🔒 ⚠ **THE TWO QUESTIONS ARE ASKED BY THE TWO SHARED PREDICATES SINCE
 * 2026-09-18 (Samuel’s ruling; F-718 RESOLVED).** *Is channel scope a thing
 * here* is `shared/tenancy/channel-scope.ts › channelScopeAllowedForKind`;
 * *is this room shared* is `shared/tenancy/shared-room.ts › isSharedRoom`. The
 * retired conjunction (`kind !== "link"` then `memberCount <= 1`) failed OPEN
 * twice: a count of `0` — a roster race, a `status` flip mid-request — took the
 * unrestricted arm, and every kind added to the union after `link` inherited it.
 *
 * ⚠ **A STANDARD WORKSPACE HAS NO GRANT ARM TO NARROW TO, WHICH IS WHY IT IS
 * UNRESTRICTED RATHER THAN NARROWED.** The 2026-09-17 scope ruling refuses a
 * channel-scoped grant there (`assertChannelScopeAllowedInContainer`) and
 * `channelsWhereScopeIsIgnored` drops any an older write left, so the granted
 * set in a standard container is empty BY CONSTRUCTION: taking that arm would
 * blank every colleague’s agent rather than bound it. The audience there is the
 * MEMBER’s — workspace-wide plus teams, applied by `service-shared.ts ›
 * canSeeBase` / `› filterTeamVisibleBases` one layer out — and an agent sees
 * exactly what the person holding its credential sees.
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
 * ctx.source !== "agent"        → unrestricted  (humans are unaffected, full stop)
 * channel scope not allowed     → unrestricted  (STANDARD, and an absent kind —
 *                                                the audience is the member’s)
 * !isSharedRoom(active members) → unrestricted  (SOLO — exactly one member)
 * else                          → granted       (grant row or 404)
 * ```
 *
 * The order is the query budget: a human costs zero extra reads, a
 * standard-workspace agent one, and only an agent inside a shared channel-scoped
 * container pays the full four. `listBases` runs on every knowledge page load.
 *
 * 🔒 **BOTH UNKNOWNS FAIL CLOSED, AND THEY FAIL CLOSED IN OPPOSITE
 * DIRECTIONS.** An unreadable member count is NOT solo (`isSharedRoom`: only an
 * exact `1` is) and takes the narrowed branch. An unrecognised KIND is not
 * standard, so channel scope is allowed there and it takes the narrowed branch
 * too — the negative `kind !== "link"` it replaces admitted every kind added
 * after it (F-295/F-564).
 *
 * A missing workspace row answers `unrestricted`, which is the same reading
 * `channelScopeAllowedForKind(null)` takes and not a fourth policy:
 * `withWorkspaceAuth` already proved an active membership before this runs, so
 * `null` means the row vanished mid-request and every read underneath answers
 * nothing anyway.
 */
export async function resolveAgentAudience(
  ctx: KnowledgeContext
): Promise<AgentAudience> {
  if (ctx.source !== "agent") return UNRESTRICTED;

  const db = supabaseAdmin();
  // The raw column, widened to the union at the one place that asks a predicate
  // of it: an unrecognised string is not `standard`, which is the arm it needs.
  const kind = (await findWorkspaceKind(db, ctx.workspaceId)) as
    | WorkspaceKind
    | null;
  if (!channelScopeAllowedForKind(kind)) return UNRESTRICTED;

  const memberCount = await countActiveWorkspaceMembers(db, ctx.workspaceId);
  if (!isSharedRoom(memberCount)) return UNRESTRICTED;

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
