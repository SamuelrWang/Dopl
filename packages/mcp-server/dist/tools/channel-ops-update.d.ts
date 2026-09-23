/**
 * `dopl_channel` op="rooms" action="update" — THE CHANNEL'S NAME, DESCRIPTION AND INFO CARD.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan.
 *
 * ── THREE FIELDS, TWO GATES (DMP-001, 2026-09-23) ──────────────────────────
 *
 * `PATCH /api/channels/{id}` accepts four things and they do not share a gate:
 *   - `visibility` is field-level `sessionOnly` — an agent token is refused it
 *     outright, in the route, and nothing here goes near it.
 *   - `name` / `topic` ("description") are MANAGE writes (`canManageChannel`:
 *     the room's owner or a workspace admin). ⚠ They were withheld until
 *     2026-09-23 because no UI could make them (F-346, ruling Q12 (b)); the
 *     channel Info tab now saves both (`use-channel-header-writes.ts`), so the
 *     operator's undo is a click, and the agent reaches the same outcome here.
 *     A non-manager is refused by NAME (`CHANNEL_MANAGE_REQUIRED`), not a 403.
 *   - `infoCard` is documented as *deliberately* agent-writable and gated on
 *     MEMBERSHIP rather than session (Samuel, 2026-08-25): it is the channel's
 *     shared scratch surface and changes no visibility, roster, lifecycle or
 *     fact.
 *
 * ── THE CARD IS REPLACED WHOLE, WHICH IS WHY THE READ IS HERE TOO ──────────
 *
 * The route takes THE WHOLE CARD, every time — a patch language for a small,
 * bounded, single-surface object would need an ordering rule, a conflict rule
 * and a second shape to test, to buy nothing. That makes a blind write
 * DESTRUCTIVE: an agent appending one row without knowing the others would drop
 * them. ⚠ So **omitting `info_card` READS the current card and changes nothing**
 * — the read-modify-write handle the whole-card contract requires, without a
 * second op to gate, classify and describe.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
/** What the tool accepts for one row. ⚠ `id` OPTIONAL: ids are client-minted and
 *  an agent has no reason to invent one, so an absent id is minted here. */
export interface InfoCardRowArg {
    id?: string;
    label: string;
    value?: string;
}
export interface InfoCardArg {
    hidden?: string[];
    rows?: InfoCardRowArg[];
}
/** What `rooms.update` may change. Every key absent is the READ. */
export interface RoomUpdateArg {
    card?: InfoCardArg;
    /** The new channel name (MANAGE-gated). */
    name?: string;
    /** The new description — the wire field `topic` (MANAGE-gated); "" clears it. */
    description?: string;
}
/**
 * READ the room, or write its name, description and/or info card in ONE patch.
 *
 * ⚠ ALL THREE ABSENT IS THE READ, and it is documented on the op rather than
 * inferred: the card is replaced whole, so an agent that cannot see the current
 * one can only clobber it.
 */
export declare function opUpdate(client: DoplClient, ref: string, arg: RoomUpdateArg): Promise<ToolResponse>;
