import { z } from "zod";
import { safeLabel, safeOptionalLabel } from "@/shared/lib/safe-label";
import { closedEnum } from "@/shared/lib/closed-enum";

/**
 * THE CURATED MAIN-INFO CARD — one channel's Info tab, as the operator left it
 * (Samuel, 2026-08-25).
 *
 * A channel's Info tab ships a fixed "Main info" list (Email / Created / Last
 * activity). This module is the contract for the two edits that ruling adds:
 * REMOVING one of those rows, and ADDING a custom `label: value` pair. Both are
 * card state, not facts — see {@link ChannelInfoCard.hidden}.
 *
 * ⚠ ONE MODULE, THREE CONSUMERS, AND THAT IS WHY IT IS NOT UNDER `server/`. The
 * route's zod schema, the DTO's shape and the SPA's rendering all need the same
 * answer to "what is a card"; the desktop renderer's ESLint fence blocks every
 * `features/<x>/server/` path, so a second copy over there is what a `server/`
 * home would actually buy. Same reasoning as `features/home/schema.ts`.
 *
 * ⚠ THE DATABASE HOLDS A THIRD STATEMENT OF THE BOUNDS AND NO TYPESCRIPT CAN
 * REACH IT — `channels_info_card_check` (migration
 * `20260825120000_channel_info_card.sql`) asserts a JSON OBJECT under 4 KiB.
 * That constraint is the FLOOR, not the product rule: the caps below are far
 * tighter, and a card that satisfies them cannot approach it. If they are ever
 * loosened past the floor, the failure is an opaque 500 at the constraint, so
 * loosen the SQL first.
 */

/**
 * The built-in rows a card may hide, by KEY.
 *
 * ⚠ A CLOSED SET, deliberately. The alternative — any string — turns the field
 * into a junk drawer that outlives the rows it names, and nothing would ever
 * tell you a key had stopped meaning anything. Adding a built-in row to the Info
 * tab is therefore an edit HERE as well as in the renderer, which is the point:
 * a row with no key cannot be removed, and a key with no row is dead weight.
 *
 * ⚠ `email` is PEER-ONLY and `created` / `lastActivity` are on every channel
 * (`pages/home/person-info-tab.tsx`). A key hidden on a channel that does not
 * render that row is inert rather than wrong — the operator hid a row, then the
 * peer left; restoring the peer restores the choice they made.
 */
export const INFO_CARD_BUILT_IN_KEYS = ["email", "created", "lastActivity"] as const;

export type ChannelInfoCardBuiltInKey = (typeof INFO_CARD_BUILT_IN_KEYS)[number];

/** At most this many CUSTOM rows on one card. A card is a glance surface; past
 *  a dozen rows it is a document, and the panel scrolls instead of reading. */
export const INFO_CARD_MAX_ROWS = 12;
/** Custom row LABEL — the left column, which must stay one short line. */
export const INFO_CARD_LABEL_MAX = 40;
/** Custom row VALUE. Longer than the label because it carries the content, and
 *  still a LABEL by `safe-label.ts`'s rule: it is spliced into a line we wrote,
 *  never rendered as its own prose. */
export const INFO_CARD_VALUE_MAX = 200;
/** Client-minted row id. A uuid is 36; the ceiling is slack, not a target. */
export const INFO_CARD_ID_MAX = 64;

/** One custom row. `value` MAY be empty — a label with nothing beside it yet is
 *  a row mid-edit, not a malformed one. */
export interface ChannelInfoCardRow {
  /** Client-minted, stable across renders and edits. See {@link newInfoCardRowId}. */
  id: string;
  label: string;
  value: string;
}

/**
 * The whole card.
 *
 * ⚠ `hidden` IS ABOUT THE CARD, NEVER ABOUT THE FACT. Removing the Email row
 * does not clear anybody's email — the address is still on the profile, still
 * on the roster, still in every other surface. What the operator changed is
 * what THIS card shows. Reading it the other way would make an × on a row a
 * destructive act on somebody else's data.
 *
 * ⚠ READONLY ARRAYS, because every helper here returns a NEW card. The cache
 * entry these come out of is shared with every other reader of that channel row
 * (INVARIANTS §8: patches operate on the raw response body), and an in-place
 * splice would edit a row other components are mid-render over.
 */
export interface ChannelInfoCard {
  readonly hidden: readonly ChannelInfoCardBuiltInKey[];
  readonly rows: readonly ChannelInfoCardRow[];
}

/**
 * The card as shipped — no row removed, nothing added. ⚠ FROZEN: it is a
 * shared default, handed to every channel whose column is still `{}`.
 *
 * ⚠ IT IS ALSO THE STALE-CACHE FALLBACK, AND EVERY READ OF `Channel.infoCard`
 * MUST SPELL IT `?? EMPTY_INFO_CARD` INLINE. The channel list is
 * IndexedDB-persisted with a 24h `gcTime` (INVARIANTS §8), so the first paint
 * after an upgrade serves rows minted before this column existed and the key is
 * simply ABSENT — a direct `channel.infoCard.hidden` read throws and blanks the
 * pane, for a field that is decoration over facts still on screen. An accessor
 * function stood here for one round and was deleted: the wire type is
 * non-optional, so a helper is the only place the optionality would be visible,
 * and a rule that lives inside a function nobody has to call is a rule the next
 * read forgets. The `??` is at the read, where a reviewer sees it.
 */
export const EMPTY_INFO_CARD: ChannelInfoCard = Object.freeze({
  hidden: Object.freeze([]) as readonly ChannelInfoCardBuiltInKey[],
  rows: Object.freeze([]) as readonly ChannelInfoCardRow[],
});

const BuiltInKeySchema = closedEnum<ChannelInfoCardBuiltInKey>()(
  INFO_CARD_BUILT_IN_KEYS
);

const InfoCardRowSchema = z.object({
  id: safeLabel("An info row id", INFO_CARD_ID_MAX),
  label: safeLabel("An info row label", INFO_CARD_LABEL_MAX),
  value: safeOptionalLabel("An info row value", INFO_CARD_VALUE_MAX),
});

/**
 * What `PATCH /api/channels/[channelId]` accepts for `infoCard`.
 *
 * ⚠ THE WHOLE CARD, EVERY TIME — not a delta. A card is small, bounded and
 * read-modify-write from one surface; a patch language for it would need an
 * ordering rule, a conflict rule and a second shape to test, to buy nothing.
 *
 * ⚠ BOTH KEYS DEFAULT, so `{}` parses to the empty card. That is what makes
 * "clear this channel's customisation" expressible without a second verb.
 *
 * ⚠ IDS ARE ASSERTED UNIQUE. Duplicates would collide as React keys and make
 * `removeInfoCardRow` ambiguous — two rows, one gesture, and no way to say
 * which the operator meant. The DB cannot check it, so this is the only fence.
 */
export const ChannelInfoCardSchema = z
  .object({
    hidden: z.array(BuiltInKeySchema).max(INFO_CARD_BUILT_IN_KEYS.length).default([]),
    rows: z.array(InfoCardRowSchema).max(INFO_CARD_MAX_ROWS).default([]),
  })
  .refine(
    (card) => new Set(card.rows.map((row) => row.id)).size === card.rows.length,
    { error: "Info card rows must have unique ids" }
  );

export type ChannelInfoCardInput = z.infer<typeof ChannelInfoCardSchema>;

/**
 * A stored `info_card` value → a card, defensively.
 *
 * ⚠ IT NEVER THROWS AND NEVER REPORTS. This runs on the READ path, where the
 * only alternative to a usable default is a channel that cannot render — and a
 * card is decoration over facts that are all still there. A value this cannot
 * make sense of (an older shape, a hand-edited row, a key retired since it was
 * written) degrades to the card as shipped rather than to an error page.
 */
export function parseInfoCard(raw: unknown): ChannelInfoCard {
  const parsed = ChannelInfoCardSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_INFO_CARD;
}

/** True when a card is the shipped one — nothing hidden, nothing added. Used to
 *  keep an untouched channel's PATCH body out of the wire. */
export function isEmptyInfoCard(card: ChannelInfoCard): boolean {
  return card.hidden.length === 0 && card.rows.length === 0;
}

/** A row id, minted where the row is. Falls back off `crypto.randomUUID` for
 *  the environments that lack it (older webviews, jsdom without the shim) —
 *  uniqueness within ONE card is the entire requirement. */
export function newInfoCardRowId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Hide a built-in row. Idempotent — hiding a hidden row is not an edit. */
export function hideBuiltInRow(
  card: ChannelInfoCard,
  key: ChannelInfoCardBuiltInKey
): ChannelInfoCard {
  if (card.hidden.includes(key)) return card;
  return { hidden: [...card.hidden, key], rows: card.rows };
}

/** Drop a custom row by id. Idempotent for the same reason. */
export function removeInfoCardRow(
  card: ChannelInfoCard,
  id: string
): ChannelInfoCard {
  if (!card.rows.some((row) => row.id === id)) return card;
  return { hidden: card.hidden, rows: card.rows.filter((row) => row.id !== id) };
}

/**
 * Add a row, or replace the one with this id.
 *
 * ⚠ AT THE CAP, A NEW ROW IS REFUSED BY RETURNING THE CARD UNCHANGED — never by
 * dropping the oldest. The rows are the operator's own notes and silently
 * evicting one to make room for another is data loss wearing a convenience's
 * clothes. An EDIT to an existing row is never refused: it does not grow the
 * card.
 */
export function upsertInfoCardRow(
  card: ChannelInfoCard,
  row: ChannelInfoCardRow
): ChannelInfoCard {
  const index = card.rows.findIndex((existing) => existing.id === row.id);
  if (index === -1) {
    if (card.rows.length >= INFO_CARD_MAX_ROWS) return card;
    return { hidden: card.hidden, rows: [...card.rows, row] };
  }
  const rows = card.rows.slice();
  rows[index] = row;
  return { hidden: card.hidden, rows };
}
