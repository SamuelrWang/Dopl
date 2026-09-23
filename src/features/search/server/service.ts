import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { isSharedCredential } from "@/shared/auth/credential-audience";
import {
  CONTAINER_ONLY_SEARCH_GROUPS,
  SEARCH_GROUP_ORDER,
  SEARCH_MIN_QUERY_LENGTH,
  type SearchGroupKind,
  type SearchResponse,
  type SearchScope,
} from "../contracts";
import { loadSearchReach, type SearchReach } from "./repository-reach";
import {
  searchArtifacts,
  searchChannels,
  searchMessages,
  searchThreads,
  type SearchHit,
} from "./repository-channel-rows";
import {
  listReadableBases,
  searchAgentIdentities,
  searchChats,
  searchKnowledgeEntries,
  searchMembers,
  searchSkills,
  type OwnerRef,
} from "./repository-container-rows";
import type { SearchCaller } from "./repository-visibility";
import { assembleGroups, type SearchLabels } from "./service-groups";

/**
 * Global search behind `GET /api/search`: `account` scope spans every container the
 * caller is in, `container` scope one. Reads run as service role, so this service is
 * the fence (INVARIANTS §2): nothing is queried that `loadSearchReach` did not prove.
 */

/** `lockedWorkspaceId` is `ctx.apiKeyWorkspaceId`, never a request field (INVARIANTS §4). */
export interface SearchContext {
  userId: string;
  credentialSubjectUserId: string | null;
  lockedWorkspaceId: string | null;
}

export interface SearchInput {
  q?: string;
  scope: SearchScope;
  container?: string;
}

/**
 * 403 for "not a member" and "no such container" alike: a 404/403 split would be a
 * membership oracle (INVARIANTS §3).
 */
const CONTAINER_FORBIDDEN = "SEARCH_CONTAINER_FORBIDDEN";

/** Every group a scope may return, in payload order. */
function groupsForScope(scope: SearchScope, standard: boolean): SearchGroupKind[] {
  const containerOnly = new Set<SearchGroupKind>(CONTAINER_ONLY_SEARCH_GROUPS);
  return SEARCH_GROUP_ORDER.filter(
    (kind) => !containerOnly.has(kind) || (scope === "container" && standard)
  );
}

export async function runSearch(
  ctx: SearchContext,
  input: SearchInput
): Promise<SearchResponse> {
  const startedAt = Date.now();
  const q = (input.q ?? "").trim();

  // Too short is a 200 with no groups, not a 400: the popup asks from the first keystroke.
  if (q.length < SEARCH_MIN_QUERY_LENGTH) {
    return { q, scope: input.scope, tookMs: Date.now() - startedAt, groups: [] };
  }

  const reach = await loadSearchReach(ctx.userId, {
    lockedWorkspaceId: ctx.lockedWorkspaceId,
    containerId: input.scope === "container" ? (input.container ?? null) : null,
  });

  if (input.scope === "container" && reach.containers.length === 0) {
    throw new HttpError(403, CONTAINER_FORBIDDEN, "No access to that container");
  }

  // A fixed set of batched reads, never a per-row fan (INVARIANTS §9).
  const byKind = await runGroupReads(ctx, input.scope, reach, q);

  const labels: SearchLabels = {
    channelById: new Map(reach.channels.map((c) => [c.id, c])),
    containerNameById: new Map(reach.containers.map((c) => [c.id, c.name])),
  };
  const standard =
    reach.containers.length === 1 &&
    // F-729: the raw column, positively; an absent or unknown kind unlocks nothing.
    reach.containers[0]?.kind === "standard";
  return {
    q,
    scope: input.scope,
    tookMs: Date.now() - startedAt,
    groups: assembleGroups(
      groupsForScope(input.scope, standard),
      byKind,
      labels,
      q
    ),
  };
}

/** The reads, in two halves following the two fences: channel and container membership. */
async function runGroupReads(
  ctx: SearchContext,
  scope: SearchScope,
  reach: SearchReach,
  q: string
): Promise<Map<SearchGroupKind, SearchHit[]>> {
  const containerIds = reach.containers.map((c) => c.id);
  const channelIds = reach.channels.map((c) => c.id);
  // A credential standing for nobody has no own rows and no grants to read.
  const ownerUserId: OwnerRef = isSharedCredential(ctx) ? null : ctx.userId;
  /** Built from the proven reach, never caller input; roles are per container (F-716). */
  const caller: SearchCaller = {
    userId: ctx.userId,
    ownerUserId,
    credentialSubjectUserId: ctx.credentialSubjectUserId,
    roleByContainer: new Map(reach.containers.map((c) => [c.id, c.role])),
  };

  const bases = await listReadableBases(containerIds, caller);
  const [channels, messages, threads, artifacts, knowledge, agentIdentities] =
    await Promise.all([
      searchChannels(channelIds, q),
      searchMessages(channelIds, q),
      searchThreads(channelIds, q),
      searchArtifacts(channelIds, q),
      searchKnowledgeEntries(bases, q),
      searchAgentIdentities(containerIds, q, caller),
    ]);

  const byKind = new Map<SearchGroupKind, SearchHit[]>([
    ["channels", channels],
    ["messages", messages],
    ["threads", threads],
    ["artifacts", artifacts],
    ["knowledge", knowledge],
    ["agentIdentities", agentIdentities],
  ]);

  // Home scope and non-standard containers must not even query these groups, so this is
  // an early return, not a filter. `kind === "standard"` is asked positively of the raw
  // column: `isStandardWorkspace` reads an absent kind as standard (F-564, F-729).
  const container = reach.containers[0];
  const servesContainerModules =
    scope === "container" &&
    reach.containers.length === 1 &&
    container !== undefined &&
    container.kind === "standard";
  if (!servesContainerModules || container === undefined) return byKind;

  const [members, skills, chats] = await Promise.all([
    searchMembers(container.id, container.name, q),
    searchSkills(container.id, q, caller),
    searchChats(container.id, q, caller),
  ]);
  byKind.set("members", members);
  byKind.set("skills", skills);
  byKind.set("chats", chats);
  return byKind;
}
