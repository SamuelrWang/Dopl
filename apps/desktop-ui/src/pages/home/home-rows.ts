import { EMPTY_PEERS } from "@/features/home/types";
import type {
  HomeChannel,
  HomeChannelsPayload,
  HomePeer,
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

/**
 * EVERY member's name and email for a channel with people in it; label + URL for
 * a link nobody has taken yet. A solo channel searches by its own name.
 *
 * ⚠ **ALL OF THEM, NOT THE FIRST (2026-08-26).** This read `peer` alone, which
 * was the whole roster while the two-member cap held. Searching only the head of
 * a four-person channel would hide it from a query naming anybody else in it —
 * and the operator has no way to tell a missing match from a missing channel.
 */
function searchText(row: HomeRow): string {
  if (row.kind === "channel") {
    const people = channelPeople(row.channel);
    const faces = people
      .map((p) => `${p.displayName ?? ""} ${p.email ?? ""}`)
      .join(" ");
    return `${row.channel.name} ${faces}`.toLowerCase();
  }
  return `${row.link.label ?? ""} ${row.link.url}`.toLowerCase();
}

/**
 * Does this row have an invitation OUT — one minted, unclaimed and not revoked?
 *
 * ⚠ TWO SHAPES, ONE QUESTION (2026-08-25). A BOUND link is a state of a channel
 * (`linkOut`); a LEGACY unbound one has no channel and is a row of its own. The
 * row's "Link out" chip is the ONLY reader since 2026-08-27 — the segmented
 * "All | Links" filter and its badge, the other two, are deleted (Samuel: links
 * are no longer a filterable state). It stays ONE named predicate because the
 * chip has to answer for both shapes, and an inline test that knows only one of
 * them renders a row with an open invitation as a row without one.
 */
export function hasLinkOut(row: HomeRow): boolean {
  return row.kind === "link" || row.channel.linkOut !== null;
}

/** The list is SEARCH-narrowed and nothing else (2026-08-27). ⚠ Still a
 *  function, and still the page's — the record pane resolves its selection from
 *  the same set the list renders, so both read one narrowing. */
export function visibleRows(rows: HomeRow[], query: string): HomeRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => !q || searchText(row).includes(q));
}

/** How many names a title spells before it starts counting. Two fit a 290px
 *  row; three truncate into uselessness. */
const TITLE_NAMES = 2;

/**
 * EVERYBODY ELSE IN THIS CHANNEL, oldest join first — the ONE read of
 * `HomeChannel.peers` on this page, and the only place the cache-shape rule for
 * it is written.
 *
 * 🔒 ⚠ **CACHE-SHAPE FALLBACK, AND IT IS A TWO-FIELD MERGE RATHER THAN A PLAIN
 * `?? EMPTY_X` — WHICH IS WHY IT IS A FUNCTION (INVARIANTS §8, and a stated
 * exception to its "spell it inline" clause).** `GET /api/home/channels` is
 * IndexedDB-persisted with a 24h `gcTime`, so the first paint after the
 * 2026-08-26 upgrade serves entries that HAVE `peer` and LACK `peers`.
 *   - `peers` present → use it, even when EMPTY (a real solo channel).
 *   - `peers` absent → fall back to the SINGLE `peer`, never to "nobody".
 * **Falling back to `EMPTY_PEERS` alone would paint every one of the operator's
 * channels as solo — "Just you", the agent glyph, no faces — which is a FALSE
 * sentence about who is in the room.** Degrading to one face is merely the old
 * answer.
 * ⚠ **§8 FORBIDS HIDING OPTIONALITY BEHIND AN ACCESSOR, and the reason is that
 * a helper nobody must call is a rule the next read forgets.** That reason is
 * answered here by ENFORCEMENT rather than by repetition: `home-rows.test.ts`
 * reads this directory's SOURCE and fails if any other file names `.peers`.
 * The merge above is one rule; two copies of it that drift is the worse bug.
 */
export function channelPeople(channel: HomeChannel): readonly HomePeer[] {
  return channel.peers ?? (channel.peer ? [channel.peer] : EMPTY_PEERS);
}

/**
 * The row's own title. A channel with people in it is titled by the PEOPLE —
 * that is what the operator is looking for in this list — and a nameless one
 * falls back to their email. A SOLO channel has no person, so it is titled by
 * the channel.
 *
 * ⚠ **THE MULTI-PERSON FORM COUNTS RATHER THAN LISTING (2026-08-26).** Two
 * names, then `+N` for the rest — `Grace, Priya +2`. A row is 290px wide and
 * ends in a timestamp, so a fourth name does not shrink the title, it deletes
 * the first one behind an ellipsis. ⚠ **THE ONE-PERSON BRANCH IS UNCHANGED, to
 * the byte, including its `|| channel.name` last resort**: a nameless, emailless
 * lone peer still reads as the channel, which is the only sensible thing left to
 * call it. That fallback is deliberately NOT extended to the multi branch —
 * naming a four-person channel after the channel while claiming to name people
 * would attribute it to whoever the reader assumes.
 */
export function channelTitle(channel: HomeChannel): string {
  const people = channelPeople(channel);
  if (people.length === 0) return channel.name;
  if (people.length === 1) {
    return people[0].displayName || people[0].email || channel.name;
  }
  const names = people.map((p) => p.displayName || p.email || "Member");
  const shown = names.slice(0, TITLE_NAMES).join(", ");
  const rest = names.length - TITLE_NAMES;
  return rest > 0 ? `${shown} +${rest}` : shown;
}

/**
 * The line UNDER the title on a channel row: who this channel is with.
 *
 * ⚠ **THE EMAIL IS A ONE-PERSON ANSWER AND MUST NOT SURVIVE INTO THE MULTI CASE
 * (2026-08-26).** With one peer the subline is their address — useful, and what
 * this row has always shown. With three, showing ONE address under a title
 * naming two different people attributes it to the wrong one; the honest line is
 * the size of the room, and the Info tab's roster is where addresses live.
 * ⚠ A SOLO channel's line is the STATIC words "Just you" (Samuel, 2026-08-24),
 * not an agent or thread count — a count here would be a second read per row for
 * a line nobody acts on.
 */
export function channelSubline(channel: HomeChannel): string {
  const people = channelPeople(channel);
  if (people.length === 0) return "Just you";
  if (people.length === 1) return people[0].email ?? "";
  return `${people.length} people`;
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
