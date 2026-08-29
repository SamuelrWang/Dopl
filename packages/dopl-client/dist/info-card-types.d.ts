/**
 * THE CHANNEL INFO CARD, on the SDK side.
 *
 * ⚠ ITS OWN MODULE for the reason `launch-types.ts` is one: `channel-types.ts`
 * hit the 500-line cap, and the card is a self-contained contract with its own
 * server twin (`src/features/channels/info-card.ts`) rather than another field
 * of the channel row. ⚠ RE-EXPORTED FROM `channel-types.ts` unchanged, so no
 * consumer moved.
 *
 * ⚠ HAND-MIRRORED, and no drift gate covers the pair. The server module is the
 * authority on bounds (12 rows, 40-char labels, 200-char values, a 3.5 KB
 * serialized ceiling under a 4 KiB DB CHECK); this side declares the SHAPE only,
 * because a second statement of the bounds is a second thing to drift.
 */
/**
 * A built-in Info-tab row a card may HIDE, by key.
 *
 * ⚠ MIRRORS `src/features/channels/info-card.ts › INFO_CARD_BUILT_IN_KEYS` — a
 * CLOSED set on both sides, hand-synced. The alternative (any string) turns the
 * field into a junk drawer that outlives the rows it names.
 */
export type ChannelInfoCardBuiltInKey = "email" | "created" | "lastActivity";
/** One custom row. `value` may be empty — a label with nothing beside it yet is
 *  a row mid-edit, not a malformed one. */
export interface ChannelInfoCardRow {
    id: string;
    label: string;
    value: string;
}
/**
 * The channel's curated Main-info card.
 *
 * ⚠ `hidden` IS ABOUT THE CARD, NEVER ABOUT THE FACT. Hiding the Email row does
 * not clear anybody's email — it changes what THIS card shows.
 *
 * ⚠ THE SERVER TYPE IS NON-OPTIONAL AND THE COLUMN IS `NOT NULL DEFAULT '{}'`,
 * but {@link Channel.infoCard} is optional HERE: the key is newer than payloads
 * some readers still hold, and an older server sends none at all. Read it as
 * `?? { hidden: [], rows: [] }`.
 */
export interface ChannelInfoCard {
    hidden: ChannelInfoCardBuiltInKey[];
    rows: ChannelInfoCardRow[];
}
/**
 * ⚠ THE WHOLE CARD, EVERY TIME — not a delta. A card is small, bounded and
 * read-modify-write from one surface; a patch language for it would need an
 * ordering rule, a conflict rule and a second shape to test, to buy nothing.
 * `{}` therefore CLEARS it, which is what makes "drop this channel's
 * customisation" expressible without a second verb.
 */
export interface ChannelUpdateInput {
    infoCard?: ChannelInfoCard;
}
