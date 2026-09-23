import "server-only";
import type {
  AgentIdentity,
  AgentIdentityContext,
  IdentityKnowledgeRef,
  IdentityKnowledgeScope,
} from "../types";
import * as repo from "./repository";
import { refKey, scopeKey } from "../lib/knowledge-scopes";
import { resolveVisibleKnowledgeScopes } from "./service-knowledge-scopes";

/**
 * Side-load knowledge onto a visible row set: one junction read plus one scope resolution, whatever
 * the row count. Filtered through the same predicate as the attach gate, so a base gone private just
 * disappears. What the filter drops is counted in `unreachableKnowledgeBaseCount` — a count and
 * nothing else (no id, name or container), because the desktop turns it into prompt text.
 */
export async function decorateWithKnowledgeBases(
  ctx: AgentIdentityContext,
  identities: AgentIdentity[]
): Promise<AgentIdentity[]> {
  if (identities.length === 0) return [];
  const links = await repo.listKnowledgeLinksForIdentities(
    ctx.workspaceId,
    identities.map((t) => t.id)
  );
  // No links is a decided zero, not "undecorated".
  if (links.length === 0) {
    return identities.map((t) => ({
      ...t,
      knowledgeBases: [],
      knowledge: [],
      unreachableKnowledgeBaseCount: 0,
    }));
  }
  const scopes = links.map(linkToScope);
  const resolved = await resolveVisibleKnowledgeScopes(ctx, scopes);
  const byKey = new Map<string, IdentityKnowledgeRef>(
    resolved.map((ref) => [refKey(ref), ref])
  );

  const byIdentity = new Map<string, IdentityKnowledgeRef[]>();
  const droppedByIdentity = new Map<string, number>();
  for (let i = 0; i < links.length; i++) {
    const ref = byKey.get(scopeKey(scopes[i]));
    const identityId = links[i].identityId;
    if (!ref) {
      droppedByIdentity.set(
        identityId,
        (droppedByIdentity.get(identityId) ?? 0) + 1
      );
      continue;
    }
    byIdentity.set(identityId, [...(byIdentity.get(identityId) ?? []), ref]);
  }
  return identities.map((t) => {
    // Sorted by display path: the junction has no order column, so reads would otherwise reshuffle.
    const knowledge = (byIdentity.get(t.id) ?? []).sort((a, b) =>
      a.path.localeCompare(b.path)
    );
    return {
      ...t,
      // The base-level slice of the same list; a folder scope must not claim its whole base.
      knowledgeBases: knowledge
        .filter((ref) => ref.scope === "base")
        .map((ref) => ({ id: ref.baseId, name: ref.baseName })),
      knowledge,
      unreachableKnowledgeBaseCount: droppedByIdentity.get(t.id) ?? 0,
    };
  });
}

/** A junction row as the domain union; a row missing the id its `scope_kind` names degrades to its base. */
function linkToScope(link: repo.IdentityKnowledgeLinkRow): IdentityKnowledgeScope {
  if (link.scopeKind === "folder" && link.folderId) {
    return { baseId: link.knowledgeBaseId, scope: "folder", folderId: link.folderId };
  }
  if (link.scopeKind === "entry" && link.entryId) {
    return { baseId: link.knowledgeBaseId, scope: "entry", entryId: link.entryId };
  }
  return { baseId: link.knowledgeBaseId, scope: "base" };
}
