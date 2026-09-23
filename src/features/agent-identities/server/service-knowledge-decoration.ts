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
 * THE KB DECORATION, lifted out of `service-reads.ts` on 2026-09-05 when the
 * reach count pushed that file into the 500-line hard cap (`eslint.config.mjs ›
 * max-lines`, ENGINEERING.md §2).
 *
 * ⚠ IT IS A SECTION, NOT A LAYER — the move
 * `repository-knowledge-links.ts` already made one layer down, on the same seam
 * and for the same reason. `service-reads.ts` owns WHICH ROWS A CALLER MAY SEE;
 * this owns WHAT THE ATTACHMENTS ON THEM RESOLVE TO. Its only caller is that
 * file, and it imports nothing from it, so the arrow points one way.
 *
 * ⚠ **SCOPED SINCE 2026-09-08.** The junction now carries base / folder / entry
 * rows, so the resolution moved one file over
 * (`service-knowledge-scopes.ts › resolveVisibleKnowledgeScopes`) and this file
 * kept the part that is genuinely about a ROW SET: grouping by identity,
 * counting what the viewer filter dropped, and deriving the base-level slice the
 * older readers still take.
 */

/**
 * Side-load knowledge refs onto a visible row set — ONE junction query plus the
 * scope resolution, regardless of row count.
 * ⚠ Filtered through the SAME `resolveVisibleKnowledgeScopes` the attach gate
 * uses, so a base that was attachable when it was attached and has since gone
 * private simply disappears from the payload rather than leaking its name.
 *
 * ⚠ **SINCE 2026-09-05 THE DISAPPEARANCE IS COUNTED** (Samuel's ruling). The
 * filter above is right and stays, but it used to be SILENT: a base attached in
 * one container and launched in another left no trace at all, so the agent read
 * a role naming no knowledge and could not report a gap it was never told about.
 * `unreachableKnowledgeBaseCount` is that trace, and it is A COUNT AND NOTHING
 * ELSE — no id, no name, no container — because the desktop turns it into prompt
 * text (`prompt-framing-agent-identity.js › unreachableKnowledgeLines`) and a location
 * would land there. It never blocks a launch: the agent starts, minus the base.
 *
 * ⚠ **A DROPPED FOLDER OR ENTRY COUNTS THE SAME WAY AND THE NAME DID NOT
 * CHANGE** (2026-09-08). The count is "attachments this view cannot resolve",
 * which is what every consumer already renders it as; splitting it into two
 * numbers would put the disclosure decision on four surfaces instead of one, and
 * a trashed entry is exactly as unreportable as a private base.
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
  // ⚠ NO LINKS IS A DECIDED ZERO, not an absence. The row went through the
  // decoration and the answer is "nothing was dropped"; leaving the field
  // undefined here would make an unattached identity indistinguishable from an
  // undecorated one for every consumer downstream.
  if (links.length === 0) {
    return identities.map((t) => ({
      ...t,
      knowledgeBases: [],
      knowledge: [],
      unreachableKnowledgeBaseCount: 0,
    }));
  }
  // ⚠ ONE RESOLUTION FOR EVERY IDENTITY IN THE SET, then split back by identity.
  // Resolving per identity would multiply the base/folder/entry reads by the row
  // count on a page that already reads them once.
  const scopes = links.map(linkToScope);
  const resolved = await resolveVisibleKnowledgeScopes(ctx, scopes);
  const byKey = new Map<string, IdentityKnowledgeRef>(
    resolved.map((ref) => [refKey(ref), ref])
  );

  const byIdentity = new Map<string, IdentityKnowledgeRef[]>();
  // ⚠ COUNTED HERE, WHERE THE DROP HAPPENS, AND NOWHERE ELSE. This loop is the
  // only place that knows both numbers; asking "how many did I lose" anywhere
  // downstream would mean a second read against the base rows, which is the
  // probe the no-location rule forbids.
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
    // ⚠ SORTED BY THE DISPLAY PATH, which puts a base and its own folders
    // together and is stable across reads. The junction has no ordering column,
    // so an unsorted list would reorder between two reads of one unchanged row.
    const knowledge = (byIdentity.get(t.id) ?? []).sort((a, b) =>
      a.path.localeCompare(b.path)
    );
    return {
      ...t,
      // ⚠ THE BASE-LEVEL SLICE, DERIVED FROM THE SAME LIST rather than resolved
      // a second time — two reads of one fact is how the two keys would come to
      // disagree. A folder scope contributes NOTHING here: listing its base
      // would tell an older reader the whole base is attached, which is a wider
      // claim than the row makes.
      knowledgeBases: knowledge
        .filter((ref) => ref.scope === "base")
        .map((ref) => ({ id: ref.baseId, name: ref.baseName })),
      knowledge,
      unreachableKnowledgeBaseCount: droppedByIdentity.get(t.id) ?? 0,
    };
  });
}

/** A junction row read back, narrowed to the domain union. ⚠ The DB's
 *  `agent_identity_kb_scope_shape_check` guarantees the id column its
 *  `scope_kind` names is populated; the fallbacks here exist so a row written
 *  before that constraint cannot produce `folderId: undefined` inside a
 *  `"folder"` scope — it degrades to the base scope it effectively is. */
function linkToScope(link: repo.IdentityKnowledgeLinkRow): IdentityKnowledgeScope {
  if (link.scopeKind === "folder" && link.folderId) {
    return { baseId: link.knowledgeBaseId, scope: "folder", folderId: link.folderId };
  }
  if (link.scopeKind === "entry" && link.entryId) {
    return { baseId: link.knowledgeBaseId, scope: "entry", entryId: link.entryId };
  }
  return { baseId: link.knowledgeBaseId, scope: "base" };
}
