import { EMPTY_PEERS } from "@/features/channels/types";
import type {
  Channel,
  ChannelListPayload,
  ChannelPeer,
  ChannelPendingLink,
} from "@/features/channels/types";

/**
 * /home's LEFT-PANE ROWS, derived from **the ONE channel projection** (Samuel's
 * ruling R-26 (b), 2026-09-17: *one endpoint*).
 *
 * 🔒 **`HOME_CHANNELS_PATH` IS DELETED WITH THE ROUTE IT NAMED.** This page reads
 * `GET /api/channels?scope=account` — `channels/hooks/use-channels.ts ›
 * useAccountChannels`, keyed by `channelKeys.list()` — and its rows are
 * `Channel`, the same type the workspace channels page renders. `HomeChannel`,
 * `HomeChannelsPayload`, `HomePeer`, `HomePendingLink` and both cache-to-cache
 * BRIDGES went with the second cache: **one cache needs no bridge** (G4).
 */

/** ⚠ NOT workspace-scoped — `withUserAuth`, no `X-Workspace-Id`. ⚠ The LEGACY
 *  unbound links' own resource, which `scope=account` folds into its payload but
 *  which the mint and the revoke still address directly. */
export const HOME_LINKS_PATH = "/api/home/links";

/**
 * ONE left-pane row. Home CHANNELS and still-open LEGACY unbound links share a
 * list because they are the same thing at two ages — a conversation you can
 * open, and one whose other side has not arrived yet.
 *
 * ⚠ A BOUND link is NOT a row. It rides on its channel as `linkOut`, because a
 * pending peer is a STATE of a channel that already exists.
 */
export type HomeRow =
  | {
      kind: "channel";
      id: string;
      /** What the row is sorted and stamped by. */
      at: string;
      channel: Channel;
    }
  | { kind: "link"; id: string; at: string; link: ChannelPendingLink };

/** ⚠ THE CONTAINER, NOT THE CHANNEL — /home addresses a relationship by the
 *  `kind='link'` workspace it lives in (one channel per container), and every
 *  caller that selects a row builds the id from a workspace id. */
export function channelRowId(workspaceId: string): string {
  return `rel:${workspaceId}`;
}

export function linkRowId(linkId: string): string {
  return `link:${linkId}`;
}

/**
 * Newest-first over both kinds, so a fresh link sits where a fresh message would.
 *
 * 🔒 **THIS IS THE ONE PLACE /home NARROWS THE ACCOUNT PAYLOAD TO HOME CHANNELS,
 * AND THE TEST IS POSITIVE — master §4.2 rule G3.** `scope=account` answers every
 * container the caller is a member of, of EVERY kind; /home is the account surface
 * for `kind='link'` containers and nothing else. ⚠ **`container.kind === "link"`,
 * NEVER `!isStandardWorkspace(…)`** — a fourth container kind is then excluded by
 * construction rather than silently admitted into a column that cannot address it
 * (a standard workspace has a route and a sidebar; this pane has neither).
 *
 * ⚠ **ONE PLACE.** Anything else on this page that wants "the operator's home
 * channels" derives them from {@link homeChannels}, which is this filter read
 * through this function — a second `container.kind` test is a second answer to
 * the question the wave exists to make singular.
 *
 * ⚠ `pendingLinks` is ABSENT under `scope=container` and present under `account`
 * (`channels/types.ts › ChannelListPayload`), so its `?? []` is the §8 read of an
 * optional key. `channels`' `?? []` is the ordinary §8 one — the payload is
 * IndexedDB-persisted, and a `.filter` on an absent key THROWS inside the page
 * rather than inside one pane (`useChannels › selectChannels` spells the same
 * fallback over the same body).
 */
export function homeRows(payload: ChannelListPayload): HomeRow[] {
  const rows: HomeRow[] = [
    ...(payload.channels ?? [])
      .filter((channel) => channel.container?.kind === "link")
      .map((channel) => ({
        kind: "channel" as const,
        id: channelRowId(channel.workspaceId),
        at: channel.lastMessageAt ?? channel.createdAt,
        channel,
      })),
    ...(payload.pendingLinks ?? []).map((link) => ({
      kind: "link" as const,
      id: linkRowId(link.id),
      at: link.createdAt,
      link,
    })),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * THE OPERATOR'S HOME CHANNELS, in the order the left pane shows them — for the
 * two surfaces that want the channels without the rows (the Ontology share popup
 * and the Overview usage filter).
 *
 * ⚠ **DERIVED FROM {@link homeRows} ON PURPOSE**, so G3's filter and this page's
 * order are stated once. A `payload.channels.filter(…)` here would be the second
 * copy of the rule the day one of them learns about a new container kind.
 */
export function homeChannels(payload: ChannelListPayload): Channel[] {
  return homeRows(payload).flatMap((row) =>
    row.kind === "channel" ? [row.channel] : []
  );
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
 *
 * ⚠ `?? null` INLINE (INVARIANTS §8): `linkOut` is a new key on a persisted
 * payload, and `undefined !== null` would light the chip on every row.
 */
export function hasLinkOut(row: HomeRow): boolean {
  return row.kind === "link" || (row.channel.linkOut ?? null) !== null;
}

/**
 * 🔒 **`visibleRows` AND ITS `searchText` ARE DELETED (Samuel, 2026-09-17:**
 * *"right now, during search, it just filters by channel name, and it like
 * removes channel on the left sidebar. that doesnt make sense, it should be a
 * pop up like this."*). The header pill drives a popup now
 * (`@/features/search/components/search-popup`) and this column shows every row,
 * always — so there is no narrowing to own here, and `index.tsx` hands the list
 * and the record pane the SAME `homeRows` output. **Do not re-derive a filter
 * for this list**: two answers to one query is the bug the popup replaced.
 */

/**
 * EVERYBODY ELSE IN THIS CHANNEL, oldest join first — the ONE read of
 * `Channel.peers` on this page.
 *
 * 🔒 **IT IS A PLAIN `?? EMPTY_PEERS` NOW, SPELLED INLINE, AND THE TWO-FIELD
 * MERGE IS GONE (Wave 3, R-26).** It used to fall back through a second field
 * (`HomeChannel.peer`) because `GET /api/home/channels` was IndexedDB-persisted
 * with a 24h `gcTime`, so the first paint after the 2026-08-26 upgrade served
 * entries that HAD `peer` and LACKED `peers`. **That payload and its cache entry
 * no longer exist.** The account list is read under
 * `["/api/channels", undefined, {scope:"account"}]` — a tuple no bundle has ever
 * written — so there is no persisted entry carrying `peer`, nothing to degrade
 * from, and the §8 exception this function held is retired with it.
 *
 * ⚠ **IT STAYS A FUNCTION, AND ITS ENFORCEMENT STAYS**: `home-rows.test.ts` reads
 * this directory's SOURCE and fails if any other file names `.peers`. One named
 * presenter is also what `agent-panel-cards.tsx` memoises against.
 */
export function channelPeople(channel: Channel): readonly ChannelPeer[] {
  return channel.peers ?? EMPTY_PEERS;
}

/**
 * The row's own title — **THE CHANNEL'S NAME, ALWAYS.**
 *
 * 🔒 **THE MEMBER-DERIVED TITLE IS DELETED (Samuel, 2026-09-01), AND THIS IS A
 * MODEL CORRECTION, NOT A TWEAK.** This function used to name a channel after
 * the PEOPLE in it — one peer's display name, then their email, then two names
 * and a `+N` — which made a channel's identity a function of its membership. So
 * adding somebody to a channel RENAMED it: the row you had been working in for
 * a week became "Priya Shah" (or `priya@shahco.tax`) the moment she claimed a
 * link, and it changed again when the next person joined. **A channel's name is
 * its own immutable display identity; a roster is not a name.**
 *
 * ⚠ **THAT PRESENTATION WAS A DM'S, ON A THING THAT IS NOT A DM.** It was
 * written on 2026-08-24 when a home container really was a two-party
 * relationship, and it outlived the model twice — the channel-first inversion
 * the same week (a channel exists BEFORE anyone else is in it) and the
 * multi-member containers of 2026-08-30. ⚠ **REAL DMs ARE UNAFFECTED and their
 * code is elsewhere**: `channels.is_direct` + `Channel.directPeer`, rendered by
 * the channels feature. Nothing in this file ever touched them — home
 * containers hold a PRIVATE, NON-DIRECT channel by construction
 * (`home/server/repository-containers.ts › listContainerChannels` says so).
 *
 * ⚠ **NOTHING IS LOST.** Who is in the channel is answered by the Info tab's
 * roster, beside each face and each address, where it can be attributed.
 */
export function channelTitle(channel: Channel): string {
  return channel.name;
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
 * ⚠ `?? "guest"` INLINE, per INVARIANTS §8 — the fallback `ChannelPendingLink`'s
 * own docblock names: the DB default, the CHECK's floor, and the fail-safe for a
 * row minted before `granted_role` existed (`20260825150000`, F-319).
 */
export function linkGrantLabel(link: ChannelPendingLink): string {
  return `Joins as ${link.grantedRole ?? "guest"}`;
}

/** "Single use" / "3 of 5 used" / "Multi use". */
export function linkUsesLabel(link: ChannelPendingLink): string {
  if (link.maxUses === null) return "Multi use";
  if (link.maxUses === 1) return "Single use";
  return `${link.useCount} of ${link.maxUses} used`;
}
