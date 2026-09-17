import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { isSharedCredential } from "@/shared/auth/credential-audience";
import { isStandardWorkspace } from "@/features/workspaces/types";
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
  searchAgentTemplates,
  searchChats,
  searchKnowledgeEntries,
  searchMembers,
  searchSkills,
  type OwnerRef,
} from "./repository-container-rows";
import type { SearchCaller } from "./repository-visibility";
import { assembleGroups, type SearchLabels } from "./service-groups";

/**
 * **GLOBAL SEARCH** — one surface behind `GET /api/search`, serving the desktop
 * /home page (`scope=account`: every container the caller is a member of) and a
 * workspace page (`scope=container`: that one) (Samuel, 2026-09-17).
 *
 * ── 🔒 THE FENCE, IN ONE SENTENCE ──────────────────────────────────────────
 *
 * **NOTHING IS QUERIED THAT `repository-reach.ts › loadSearchReach` DID NOT
 * PROVE.** Every read below is handed an id array built from
 * `workspace_members.user_id = <caller> AND status='active'` or from
 * `channel_members.user_id = <caller>`, so a container or channel the caller
 * does not belong to is never NAMED. The reads run as service role
 * (`RLS_CALLER_SCOPED_READS` is off, INVARIANTS §2), which makes this service the
 * fence with no backstop underneath it — the same posture, and the same
 * paragraph, as `channels/server/service-account.ts`.
 *
 * ── THE THREE RULES THAT FAIL QUIETLY ──────────────────────────────────────
 *
 * 1. 🔒 **HOME SCOPE NEVER TOUCHES members / skills / chats** (Samuel: *"those
 *    modules do not exist on home"*). It is an ABSENCE — the tables are not
 *    queried — so `service.test.ts` asserts the repositories were NOT CALLED
 *    rather than that the groups came back empty.
 * 2. 🔒 **CONTAINER SCOPE GATES THOSE THREE ON `kind='standard'` AS WELL.** A
 *    `link` (home-channel) or `personal` container has no members page, no
 *    skills shelf and no chat archive, and `isStandardWorkspace` is the one
 *    predicate that decides it (INVARIANTS §4A, F-295 — the POSITIVE form).
 * 3. 🔒 **A SHARED CREDENTIAL LOSES EVERY OWN-ROW ARM.** `isSharedCredential`
 *    (`shared/auth/credential-audience.ts`) is arm 2 of every `canSee*` predicate
 *    in this codebase; here it collapses `ownerUserId` to `null` before any
 *    visibility clause is written, so a credential standing for nobody reaches
 *    only the widest-visibility rows.
 */

/** What the route hands in. ⚠ `lockedWorkspaceId` is `ctx.apiKeyWorkspaceId` and
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
 * 🔒 **403 FOR "NOT A MEMBER" *AND* FOR "NO SUCH CONTAINER", DELIBERATELY THE
 * SAME ANSWER.** INVARIANTS §3's rule is that membership existence must not be
 * leaked, and `authz.ts › requireWorkspaceRole` spells that as a 404. This route
 * answers 403 — the shape the popup is built against — and gets the same
 * property a different way: the membership PROOF is narrowed rather than
 * checked, so a container that does not exist and one the caller is not in are
 * literally the same empty read and produce one indistinguishable refusal. **Do
 * not "fix" this into a 404-for-missing / 403-for-forbidden split; that split IS
 * the oracle both codes exist to deny.**
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

  // ⚠ **TOO SHORT IS A 200 WITH NO GROUPS, NEVER A 400** (contract). The popup
  // mounts and asks on the first keystroke; an error there would render as a
  // failed search rather than as "keep typing". No query runs, so this costs
  // nothing — which is the other half of why it is not a validation failure.
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

  // ⚠ ONE `Promise.all` OVER A FIXED SET OF READS — never a per-row or
  // per-container fan (INVARIANTS §9). The container-only reads are absent from
  // the array entirely in account scope, not present-and-discarded.
  const byKind = await runGroupReads(ctx, input.scope, reach, q);

  const labels: SearchLabels = {
    channelById: new Map(reach.channels.map((c) => [c.id, c])),
    containerNameById: new Map(reach.containers.map((c) => [c.id, c.name])),
  };
  const standard =
    reach.containers.length === 1 && isStandardWorkspace(reach.containers[0]);
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
  // 🔒 RULE 3 — see the header. A credential with nobody behind it has no own
  // rows to reach, so every arm below the widest visibility is dropped before
  // any clause is written.
  const ownerUserId: OwnerRef = isSharedCredential(ctx) ? null : ctx.userId;
  /**
   * 🔒 **THE CALLER, AS THE FOUR `canSee*` PREDICATES NEED THEM (F-716).** Built
   * ONCE per request from the reach that proved access — never re-derived, and
   * never from anything the caller sent. The role map is what makes the
   * workspace-admin arms container-correct in account scope.
   */
  const caller: SearchCaller = {
    userId: ctx.userId,
    ownerUserId,
    credentialSubjectUserId: ctx.credentialSubjectUserId,
    roleByContainer: new Map(reach.containers.map((c) => [c.id, c.role])),
  };

  const bases = await listReadableBases(containerIds, caller);
  const [channels, messages, threads, artifacts, knowledge, agentTemplates] =
    await Promise.all([
      searchChannels(channelIds, q),
      searchMessages(channelIds, q),
      searchThreads(channelIds, q),
      searchArtifacts(channelIds, q),
      searchKnowledgeEntries(bases, q),
      searchAgentTemplates(containerIds, q, caller),
    ]);

  const byKind = new Map<SearchGroupKind, SearchHit[]>([
    ["channels", channels],
    ["messages", messages],
    ["threads", threads],
    ["artifacts", artifacts],
    ["knowledge", knowledge],
    ["agentTemplates", agentTemplates],
  ]);

  // 🔒 RULES 1 AND 2 — the three container-only groups. The guard is an EARLY
  // RETURN rather than a filter on the results, because what must be true is
  // that the QUERIES DID NOT HAPPEN.
  //
  // ⚠ **THE POSITIVE FORM, AND IT IS F-564's RULE RATHER THAN A STYLE CHOICE.**
  // `!isStandardWorkspace(x)` does NOT mean "therefore a home channel" — it
  // means "not the listing kind", and since `20260920120000` there are three
  // kinds. Asking the question positively is what makes a FOURTH kind inherit
  // the refusal instead of opting into it, which is exactly the disposition
  // `workspaces/home-channel-derivation.test.ts` is a census of.
  const container = reach.containers[0];
  const servesContainerModules =
    scope === "container" &&
    reach.containers.length === 1 &&
    container !== undefined &&
    isStandardWorkspace(container);
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
