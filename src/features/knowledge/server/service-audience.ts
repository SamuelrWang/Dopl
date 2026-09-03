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
 * THE AGENT AUDIENCE CEILING — layer A of the ceiling (plan
 * `docs/specs/home-knowledge-panels.plan.md` §4.2), and the only part of it that
 * is a FENCE rather than a tripwire.
 *
 * The question it answers: *an agent is acting inside a link container that has
 * a peer in it — which knowledge bases may it read?* The answer is the ones the
 * operator GRANTED into one of that container's channels, and nothing else. It
 * is applied at the four foundational lookups in `service-bases.ts`
 * (`listBases`, `getBaseById`, `getBaseBySlug`, and — when one exists — the
 * public-id lookup), because every other knowledge read composes one of them.
 *
 * 🔒 IT IS A FENCE BECAUSE EVERY INPUT IS A DB FACT ON THE SERVICE CLIENT.
 * `repository-audience.ts` re-reads the workspace's kind, its active member
 * count, its channel ids and its grant rows. Nothing here is decided by a
 * header, a prompt, a tool description, or anything else an agent can type.
 * That distinction is the whole design: B2 (the desktop grant gate) and B3 (the
 * MCP directory lock) are TRIPWIRES — an agent with Bash and the on-disk 90-day
 * device token can step around either — and this layer is what still holds when
 * they are stepped around, because the refusal happens inside the server that
 * owns the rows.
 *
 * 🔒 IT ONLY EVER CLOSES. Three of the four branches answer `unrestricted`,
 * which is today's behaviour exactly; the fourth removes reach. No branch of
 * this module can make a base reachable that was not reachable before it
 * existed, so it cannot be the cause of a leak — only of a 404.
 *
 * ⚠ THE SOLO CASE IS DELIBERATELY UNTOUCHED. A one-member container is the
 * operator's own primary agent surface (§4A's traffic-profile bullet), and
 * narrowing it would break the daily path to protect an audience of one person
 * who is the operator. The ceiling exists because a PEER arrived; with no peer
 * there is no second audience to bound.
 *
 * ⚠ CONSEQUENCE, AND IT IS RULING 2, NOT AN ACCIDENT: a scope-B base (private,
 * in the container, ungranted) becomes INVISIBLE to the operator's own agent in
 * a shared channel until it is granted `agent_only`. Samuel confirmed the strict
 * reading; the /home UI copy says so.
 *
 * ⚠ AND IT BOUNDS FUTURE READS, NEVER CONTEXT ALREADY IN THE WINDOW (§4.5,
 * pinned in INVARIANTS §11). A solo channel that gains a peer tightens at the
 * next tool call; it cannot un-read what a running session has already been
 * handed. That is why the bound claim PARKS the container's live sessions
 * (RULING 5) — the ceiling is not, and cannot be, retroactive.
 */

/**
 * What one agent may reach in one workspace.
 *
 * `unrestricted` is the pre-ceiling behaviour verbatim and carries no set — a
 * separate SHAPE rather than a boolean beside a set, so a caller cannot read an
 * empty set as "unrestricted" or an unrestricted answer as "reaches nothing".
 * Those two mistakes are opposite and both are silent.
 */
export type AgentAudience =
  | { readonly kind: "unrestricted" }
  | {
      readonly kind: "granted";
      /** Base ids carrying a grant (EITHER level) on one of {@link channelIds}. */
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
 * ⚠ THE ORDER IS THE QUERY BUDGET. A human caller costs ZERO extra reads, a
 * standard-workspace agent costs ONE, and only an agent inside a shared
 * container pays the full four. `listBases` runs on every knowledge page load,
 * so a ceiling that cost four reads for everybody would be a performance
 * regression dressed as a security control.
 *
 * ⚠ AN UNREADABLE MEMBER COUNT FAILS CLOSED — `null` is treated as "not solo"
 * and takes the narrowed branch. Unknown is not the same as one, and the safe
 * reading of "I could not count the people in this room" is that there is
 * somebody in it.
 *
 * ⚠ A MISSING WORKSPACE ROW ANSWERS `unrestricted`, and that is not a hole:
 * `withWorkspaceAuth` already proved an active membership of that workspace
 * before this runs, so `null` here means the row vanished mid-request and every
 * read underneath is about to answer nothing anyway. Failing CLOSED on it would
 * put a spurious 404 on the standard-workspace path for a race that changes no
 * outcome.
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
  // ⚠ NO CONTAINER ARGUMENT (F-662). `channelIds` came from THIS container and
  // is the fence; a grant row is filed under the RESOURCE's container, so
  // naming the caller's would refuse the cross-container lend.
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
 * F-327-PROOFING (§4.3). The ceiling takes the SET of the container's channels,
 * because nothing enforces one-channel-per-container and a ceiling that assumed
 * one would fence the agent out of a room its operator really made. An
 * `X-Dopl-Session-Id` shaped `<channelId>:<tail>` may then NARROW that set to
 * the single channel the calling session belongs to — IFF the id it names is
 * already in the set. Anything else is ignored ENTIRELY: not an error, not a
 * refusal, not a partial application. The unnarrowed set stands.
 *
 * 🔒 A FORGEABLE INPUT USED ONLY TO NARROW INSIDE AN ALREADY-FENCED SET IS SAFE.
 * The header is a documented non-authorization signal and any device-token
 * holder can send any value for it (`shared/auth/session-header.ts`). What makes
 * this use of it legitimate is the direction of travel: the set was computed
 * from DB facts before the header was read, every id the header can select was
 * already IN that set, and selecting one can only REMOVE grants from the
 * answer. The worst a forged value achieves is fencing the forger out of bases
 * it was otherwise allowed to read — a self-inflicted 404. There is no value it
 * can carry that ADDS a channel, because a value naming a channel outside the
 * set is discarded rather than trusted.
 *
 * ⚠ DO NOT "IMPROVE" THIS INTO A LOOKUP. Resolving the named channel against
 * the database instead of against the set already in hand would turn the header
 * into an addressing input, and addressing is exactly the power it must not
 * have. The membership test against `containerChannelIds` IS the fence.
 *
 * ⚠ THE UUID TEST IS A SHAPE GUARD, NOT A FENCE, AND THE SUITE SAYS SO BY NOT
 * CATCHING ITS REMOVAL. Deleting it leaves every assertion in
 * `service-audience.test.ts` green, because `containerChannelIds.includes(head)`
 * already refuses anything that is not one of this container's ids — uuid-shaped
 * or otherwise. It stays because another client's opaque session handle can
 * carry a colon without naming a channel, and splitting one is noise rather than
 * a decision. Do not add a test asserting it is load-bearing; it is not.
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
