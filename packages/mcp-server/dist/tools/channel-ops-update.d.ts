/**
 * `dopl_channel` op="rooms" action="update" — THE CHANNEL'S CURATED INFO CARD, and nothing else.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan.
 *
 * ── WHY ONE FIELD (Samuel's ruling Q12 (b), 2026-08-28) ────────────────────
 *
 * `PATCH /api/channels/{id}` accepts five things and they do not share a gate:
 *   - `visibility` is field-level `sessionOnly` — an agent token is refused it
 *     outright, in the route, and nothing here goes near it.
 *   - `name` / `topic` / `archived` are MANAGE writes the route accepts and
 *     **no UI on /home or the workspace channels page can ask for** (F-346).
 *     Shipping RENAME first on the AGENT surface would leave the operator's only
 *     undo as "ask an agent", which is a worse first surface than none.
 *   - `infoCard` is documented as *deliberately* agent-writable and gated on
 *     MEMBERSHIP rather than session (Samuel, 2026-08-25): it is the channel's
 *     shared scratch surface and changes no visibility, roster, lifecycle or
 *     fact.
 *
 * So this op writes the card. Widening it is a product decision, not a schema
 * edit.
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
/**
 * READ or REPLACE the channel's info card.
 *
 * ⚠ `card === undefined` IS THE READ, and it is documented on the op rather than
 * inferred: the card is replaced whole, so an agent that cannot see the current
 * one can only clobber it.
 */
export declare function opUpdate(client: DoplClient, ref: string, card: InfoCardArg | undefined): Promise<ToolResponse>;
