import type {
  HomeChannel,
  HomeChannelsPayload,
  HomePendingLink,
} from "@/features/home/types";

/** ⚠ NOT workspace-scoped — `withUserAuth`, no `X-Workspace-Id`. */
export const HOME_CHANNELS_PATH = "/api/home/channels";
export const HOME_LINKS_PATH = "/api/home/links";

/**
 * ONE left-pane row. Home CHANNELS and still-open LEGACY unbound links share a
 * list because they are the same thing at two ages — a conversation you can
 * open, and one whose other side has not arrived yet.
 *
 * ⚠ A BOUND link is NOT a row. It rides on its channel as `linkOut`, because a
 * pending peer is a STATE of a channel that already exists — the chip that
 * renders it lands with the client wave; this file only stops it being a second
 * row.
 */
export type HomeRow =
  | {
      kind: "channel";
      id: string;
      /** What the row is sorted and stamped by. */
      at: string;
      channel: HomeChannel;
    }
  | { kind: "link"; id: string; at: string; link: HomePendingLink };

/**
 * ⚠ TWO SEGMENTS, NOT THREE. The mock's "Needs you" had no backing signal and
 * is deleted rather than faked — a filter that cannot count is a lie with a
 * badge on it.
 */
export type HomeFilter = "all" | "links";

export function channelRowId(workspaceId: string): string {
  return `rel:${workspaceId}`;
}

export function linkRowId(linkId: string): string {
  return `link:${linkId}`;
}

/** Newest-first over both kinds, so a fresh link sits where a fresh message would. */
export function homeRows(payload: HomeChannelsPayload): HomeRow[] {
  const rows: HomeRow[] = [
    ...payload.channels.map((channel) => ({
      kind: "channel" as const,
      id: channelRowId(channel.workspaceId),
      at: channel.lastMessageAt ?? channel.createdAt,
      channel,
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

/** Name + email for a channel with a person in it; label + URL for a link
 *  nobody has taken yet. A solo channel searches by its own name. */
function searchText(row: HomeRow): string {
  if (row.kind === "channel") {
    const { peer, name } = row.channel;
    return `${name} ${peer?.displayName ?? ""} ${peer?.email ?? ""}`.toLowerCase();
  }
  return `${row.link.label ?? ""} ${row.link.url}`.toLowerCase();
}

/**
 * Does this row have an invitation OUT — one minted, unclaimed and not revoked?
 *
 * ⚠ TWO SHAPES, ONE QUESTION (2026-08-25). A BOUND link is a state of a channel
 * (`linkOut`); a LEGACY unbound one has no channel and is a row of its own. The
 * "Links" filter and its badge both ask this, so they cannot disagree about
 * what the number counts — which is the bug a second inline predicate makes.
 */
export function hasLinkOut(row: HomeRow): boolean {
  return row.kind === "link" || row.channel.linkOut !== null;
}

export function visibleRows(
  rows: HomeRow[],
  filter: HomeFilter,
  query: string
): HomeRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter === "links" && !hasLinkOut(row)) return false;
    return !q || searchText(row).includes(q);
  });
}

/**
 * The row's own title. A channel with a peer is titled by the PERSON — that is
 * what the operator is looking for in this list — and a nameless peer falls back
 * to their email. A SOLO channel has no person, so it is titled by the channel.
 */
export function channelTitle(channel: HomeChannel): string {
  const { peer, name } = channel;
  if (!peer) return name;
  return peer.displayName || peer.email || name;
}

/** A URL reads as a link without its scheme; the COPY still carries the whole
 *  thing. ⚠ Here rather than in `link-out-panel.tsx`, because the Add-person
 *  popover renders the same string and importing a presenter from a panel is how
 *  the second copy gets written instead. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

/**
 * What an OPEN invitation grants its claimer — "Joins as guest" / "Joins as
 * member" (2026-08-26).
 *
 * ⚠ IT EXISTS BECAUSE THE PICKER'S CHOICE WAS INVISIBLE ONCE THE LINK EXISTED.
 * `mintContainerLink` hands an open link BACK rather than rotating it, so a
 * second "Add person" click shows an invitation somebody may have picked a
 * different role for. The server now revokes-and-remints on a mismatch; this is
 * the half that lets the operator SEE which grant is currently out.
 *
 * ⚠ `?? "guest"` INLINE, per INVARIANTS §8: `grantedRole` is a NEW field on an
 * IndexedDB-persisted payload (24h `gcTime`), so an entry written by the
 * previous bundle survives the upgrade WITHOUT the key. The wire type is
 * non-optional and is right; the cache is a different moment. `"guest"` is both
 * the DB default and the fail-safe reading.
 */
export function linkGrantLabel(link: HomePendingLink): string {
  return `Joins as ${link.grantedRole ?? "guest"}`;
}

/** "Single use" / "3 of 5 used" / "Multi use". */
export function linkUsesLabel(link: HomePendingLink): string {
  if (link.maxUses === null) return "Multi use";
  if (link.maxUses === 1) return "Single use";
  return `${link.useCount} of ${link.maxUses} used`;
}
