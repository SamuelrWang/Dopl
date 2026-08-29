/**
 * `dopl_channel` op="update" — THE CHANNEL'S CURATED INFO CARD, and nothing else.
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

import type {
  ChannelInfoCard,
  ChannelInfoCardBuiltInKey,
  DoplClient,
} from "@dopl/client";
import { randomUUID } from "node:crypto";
import { inlineOr } from "./narration";
import { ok, err, type ToolResponse } from "./respond";
import { isErr, resolveChannelOr } from "./channel-shared";

const NO_NAME = "(unnamed)";

/** The card as shipped. ⚠ The wire type is optional and an older server sends
 *  none, so every read of `channel.infoCard` spells this inline (INVARIANTS §8). */
const EMPTY_CARD: ChannelInfoCard = { hidden: [], rows: [] };

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

/** The three built-in rows a card may hide. ⚠ Hand-mirrored from
 *  `src/features/channels/info-card.ts › INFO_CARD_BUILT_IN_KEYS`; a value outside
 *  this set is refused HERE so the caller gets the list instead of a 400. */
const BUILT_IN_KEYS: readonly ChannelInfoCardBuiltInKey[] = [
  "email",
  "created",
  "lastActivity",
];

function renderCard(card: ChannelInfoCard): string[] {
  const hidden = card.hidden ?? [];
  const rows = card.rows ?? [];
  const lines: string[] = [];
  lines.push(
    hidden.length > 0
      ? `Hidden built-in rows: ${hidden.join(", ")}`
      : `Hidden built-in rows: none`,
  );
  if (rows.length === 0) {
    lines.push("Custom rows: none");
    return lines;
  }
  lines.push("Custom rows:");
  for (const row of rows) {
    // ⚠ Both halves are VALUES — a card is written by whoever is in the channel,
    // which in a home channel is a peer.
    lines.push(
      `- ${inlineOr(row.label, "`(unlabelled)`")}: ${inlineOr(row.value, "`(empty)`")} (id: \`${row.id}\`)`,
    );
  }
  return lines;
}

/**
 * Normalize the tool's argument into the route's shape, or refuse.
 *
 * ⚠ REFUSE-BEFORE-SEND on both things the route would 400 over — an unknown
 * built-in key and a duplicate row id. The route's messages are correct and
 * name neither the legal key set nor which id collided, and an opaque 400 on a
 * whole-card write is the shape an agent retries verbatim.
 */
function toCard(arg: InfoCardArg): ChannelInfoCard | ToolResponse {
  const hidden: ChannelInfoCardBuiltInKey[] = [];
  for (const key of arg.hidden ?? []) {
    if (!BUILT_IN_KEYS.includes(key as ChannelInfoCardBuiltInKey)) {
      return err(
        `Refused before sending: \`${inlineOr(key, "(unreadable)")}\` is not a built-in info row, so nothing was changed. The only rows that can be hidden are: ${BUILT_IN_KEYS.join(", ")}. To remove a CUSTOM row, leave it out of \`rows\` — the card is replaced whole.`,
      );
    }
    hidden.push(key as ChannelInfoCardBuiltInKey);
  }
  const rows = (arg.rows ?? []).map((row) => ({
    // ⚠ MINTED WHEN ABSENT. Uniqueness within ONE card is the entire
    // requirement, and making the agent invent ids invites collisions that the
    // route refuses with a message about React keys.
    id: row.id ?? randomUUID(),
    label: row.label,
    value: row.value ?? "",
  }));
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) {
      return err(
        `Refused before sending: two info rows share the id \`${row.id}\`, so nothing was changed. Ids must be unique within a card — omit \`id\` on a NEW row and one is minted for you; pass it only to EDIT the row that already has it.`,
      );
    }
    seen.add(row.id);
  }
  return { hidden, rows };
}

/**
 * READ or REPLACE the channel's info card.
 *
 * ⚠ `card === undefined` IS THE READ, and it is documented on the op rather than
 * inferred: the card is replaced whole, so an agent that cannot see the current
 * one can only clobber it.
 */
export async function opUpdate(
  client: DoplClient,
  ref: string,
  card: InfoCardArg | undefined,
): Promise<ToolResponse> {
  const channel = await resolveChannelOr(client, ref);
  if (isErr(channel)) return channel;
  const label = inlineOr(channel.name, NO_NAME);

  if (card === undefined) {
    return ok(
      [
        `Info card for **${label}** — READ ONLY, nothing was changed.`,
        ...renderCard(channel.infoCard ?? EMPTY_CARD),
        "",
        `⚠ The card is REPLACED WHOLE on a write. To add a row, re-issue op="update" with \`info_card\` carrying EVERY row above plus the new one — a write that omits a row deletes it. Send \`info_card={}\` to clear the card deliberately.`,
      ].join("\n"),
    );
  }

  const built = toCard(card);
  if ("isError" in built && built.isError) return built as ToolResponse;

  const updated = await client.updateChannel(channel.id, {
    infoCard: built as ChannelInfoCard,
  });
  return ok(
    [
      `Updated the info card on **${label}**.`,
      ...renderCard(updated.infoCard ?? (built as ChannelInfoCard)),
      "",
      `⚠ Everyone in this channel sees this card. It changes no permission, no roster and no fact — hiding the Email row hides a ROW, it does not clear anybody's address.`,
    ].join("\n"),
  );
}
