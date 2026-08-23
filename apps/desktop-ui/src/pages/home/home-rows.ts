import type {
  HomePendingLink,
  HomeRelationship,
  HomeRelationshipsPayload,
} from "@/features/home/types";

/** ⚠ NOT workspace-scoped — `withUserAuth`, no `X-Workspace-Id`. */
export const HOME_RELATIONSHIPS_PATH = "/api/home/relationships";
export const HOME_LINKS_PATH = "/api/home/links";

/**
 * ONE left-pane row. Claimed relationships and still-open links share a list
 * because they are the same thing at two ages — a person you can talk to, and a
 * person who has not arrived yet.
 */
export type HomeRow =
  | {
      kind: "relationship";
      id: string;
      /** What the row is sorted and stamped by. */
      at: string;
      relationship: HomeRelationship;
    }
  | { kind: "link"; id: string; at: string; link: HomePendingLink };

/**
 * ⚠ TWO SEGMENTS, NOT THREE. The mock's "Needs you" had no backing signal and
 * is deleted rather than faked — a filter that cannot count is a lie with a
 * badge on it.
 */
export type HomeFilter = "all" | "links";

export function relationshipRowId(workspaceId: string): string {
  return `rel:${workspaceId}`;
}

export function linkRowId(linkId: string): string {
  return `link:${linkId}`;
}

/** Newest-first over both kinds, so a fresh link sits where a fresh message would. */
export function homeRows(payload: HomeRelationshipsPayload): HomeRow[] {
  const rows: HomeRow[] = [
    ...payload.relationships.map((relationship) => ({
      kind: "relationship" as const,
      id: relationshipRowId(relationship.workspaceId),
      at: relationship.lastMessageAt ?? relationship.connectedAt,
      relationship,
    })),
    ...payload.pendingLinks.map((link) => ({
      kind: "link" as const,
      id: linkRowId(link.id),
      at: link.createdAt,
      link,
    })),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

/** Name + email for a person; label + URL for a link nobody has taken yet. */
function searchText(row: HomeRow): string {
  if (row.kind === "relationship") {
    const { displayName, email } = row.relationship.peer;
    return `${displayName ?? ""} ${email ?? ""}`.toLowerCase();
  }
  return `${row.link.label ?? ""} ${row.link.url}`.toLowerCase();
}

export function visibleRows(
  rows: HomeRow[],
  filter: HomeFilter,
  query: string
): HomeRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter === "links" && row.kind !== "link") return false;
    return !q || searchText(row).includes(q);
  });
}

/** The row's own name — a nameless peer falls back to their email, then the id. */
export function peerLabel(relationship: HomeRelationship): string {
  const { displayName, email, userId } = relationship.peer;
  return displayName || email || userId;
}

/** A URL reads as a link without its scheme; the COPY still carries the whole
 *  thing. ⚠ Here rather than in `pending-link-card.tsx`, because the New-link
 *  popover renders the same string and importing a presenter from a card is how
 *  the second copy gets written instead. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

/** "Single use" / "3 of 5 used" / "Multi use". */
export function linkUsesLabel(link: HomePendingLink): string {
  if (link.maxUses === null) return "Multi use";
  if (link.maxUses === 1) return "Single use";
  return `${link.useCount} of ${link.maxUses} used`;
}
