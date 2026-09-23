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
 * Global search behind `GET /api/search`: `scope=account` for /home (every
 * container the caller is a member of), `scope=container` for one workspace.
 *
 * The fence: nothing is queried that `loadSearchReach` did not prove. Every read
 * is handed an id array built from the caller's active memberships, so a
 * container or channel they do not belong to is never named. The reads run as
 * service role (INVARIANTS §2), so this service is the fence with no backstop.
 *
 * Three rules that fail quietly:
 * 1. Home scope never TOUCHES members / skills / chats — an absence, so
 *    `service.test.ts` asserts the repositories were not called.
 * 2. Container scope gates those three on `kind === "standard"` too — asked
 *    POSITIVELY of the RAW column, never through `isStandardWorkspace`
 *    (F-729, 2026-09-18). That predicate reads an absent kind AS standard,
 *    which is fail-closed where `standard` denies and fail-OPEN here, where
 *    `standard` is what unlocks the three groups.
 * 3. A shared credential loses every own-row arm: `isSharedCredential` collapses
 *    `ownerUserId` to `null` before any visibility clause is written.
 */

/** What the route hands in. `lockedWorkspaceId` is `ctx.apiKeyWorkspaceId` and
 *  can never be a request field (INVARIANTS §4/§10, R3). */
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
 * 403 for "not a member" AND for "no such container", deliberately the same
 * answer (INVARIANTS §3: membership existence must not leak). The membership
 * proof is narrowed rather than checked, so both are the same empty read. Do not
 * split this into 404-for-missing / 403-for-forbidden — that split is the oracle
 * both codes exist to deny.
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

  // Too short is a 200 with no groups, never a 400 (contract): the popup asks on
  // the first keystroke, and an error would render as a failed search rather than
  // "keep typing". No query runs.
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

  // One `Promise.all` over a fixed set of reads, never a per-row or per-container
  // fan (INVARIANTS §9). In account scope the container-only reads are absent from
  // the array entirely, not present-and-discarded.
  const byKind = await runGroupReads(ctx, input.scope, reach, q);

  const labels: SearchLabels = {
    channelById: new Map(reach.channels.map((c) => [c.id, c])),
    containerNameById: new Map(reach.containers.map((c) => [c.id, c.name])),
  };
  const standard =
    reach.containers.length === 1 &&
    // F-729: `=== "standard"` of the raw column. An unknown or absent kind
    // offers no container-only group rather than every one of them.
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

/**
 * The reads, run together. Split out so {@link runSearch} reads as the gate it
 * is; the two halves are the two fences (channel membership, container
 * membership) and the split follows them.
 */
async function runGroupReads(
  ctx: SearchContext,
  scope: SearchScope,
  reach: SearchReach,
  q: string
): Promise<Map<SearchGroupKind, SearchHit[]>> {
  const containerIds = reach.containers.map((c) => c.id);
  const channelIds = reach.channels.map((c) => c.id);
  // Rule 3: a credential with nobody behind it has no own rows, so every arm
  // below the widest visibility is dropped before any clause is written.
  const ownerUserId: OwnerRef = isSharedCredential(ctx) ? null : ctx.userId;
  /**
   * F-716: the caller as the four `canSee*` predicates need them. Built once per
   * request from the reach that proved access, never from caller input. The role
   * map is what makes the workspace-admin arms container-correct in account scope.
   */
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

  // Rules 1 and 2: an early return, not a filter on the results, because what
  // must be true is that the queries did not happen.
  // F-564: the POSITIVE form. "Not the listing kind" is not "therefore a home
  // channel", and there are three kinds — asking positively makes a fourth kind
  // inherit the refusal rather than opt into it.
  // F-729: and it asks the RAW column, not `isStandardWorkspace`, which reads an
  // ABSENT kind as standard. Here that is the permissive side, so `null` — a
  // narrowed projection, a kind this build does not know — must refuse.
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
