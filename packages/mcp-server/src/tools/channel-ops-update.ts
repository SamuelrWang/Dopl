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

import type {
  ChannelInfoCard,
  ChannelInfoCardBuiltInKey,
  ChannelUpdateInput,
  DoplClient,
} from "@dopl/client";
import { randomUUID } from "node:crypto";
import { inlineOr, neutralizeInline, NO_NAME } from "./narration";
import { ok, err, type ToolResponse } from "./respond";
import { isErr, resolveChannelOr } from "./channel-shared";
import { isForbidden } from "./channel-errors";
import { CHANNEL_MANAGE_REQUIRED, refusal } from "./tool-errors";

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

/** The channel's DESCRIPTION line, or nothing. ⚠ "Description" is the product's
 *  word for the wire field `topic` (ruling, Samuel, 2026-09-15). An array so the
 *  caller can splice it away when it is empty. */
function descriptionLine(topic: string | null | undefined): string[] {
  const safe = topic ? neutralizeInline(topic) : null;
  return safe ? [`Description: ${safe}`] : [];
}

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

/** What `rooms.update` may change. Every key absent is the READ. */
export interface RoomUpdateArg {
  card?: InfoCardArg;
  /** The new channel name (MANAGE-gated). */
  name?: string;
  /** The new description — the wire field `topic` (MANAGE-gated); "" clears it. */
  description?: string;
}

/** The canonical facts a header write hands back: id, name, description, update time. */
function headerFacts(c: {
  id: string;
  name: string;
  topic: string | null | undefined;
  updatedAt: string;
}): string {
  const description = c.topic ? inlineOr(c.topic, "`(empty)`") : "`(none)`";
  return `id=\`${c.id}\` · name=${inlineOr(c.name, NO_NAME)} · description=${description} · updated=${c.updatedAt}`;
}

/**
 * READ the room, or write its name, description and/or info card in ONE patch.
 *
 * ⚠ ALL THREE ABSENT IS THE READ, and it is documented on the op rather than
 * inferred: the card is replaced whole, so an agent that cannot see the current
 * one can only clobber it.
 */
export async function opUpdate(
  client: DoplClient,
  ref: string,
  arg: RoomUpdateArg,
): Promise<ToolResponse> {
  const { card } = arg;
  // Refused before the resolve: an empty name is a 400 the route explains worse.
  if (arg.name !== undefined && arg.name.trim() === "") {
    return err(
      `Refused before sending: a channel name cannot be empty, so nothing was changed. Pass the new name, or omit \`name\` to keep it.`,
    );
  }
  const channel = await resolveChannelOr(client, ref);
  if (isErr(channel)) return channel;
  const label = inlineOr(channel.name, NO_NAME);
  const header = arg.name !== undefined || arg.description !== undefined;

  if (card === undefined && !header) {
    return ok(
      [
        // Name and description already print on their own lines; the id and clock are the handles.
        `Info card for **${label}** — READ ONLY, nothing was changed. id=\`${channel.id}\` · updated=${channel.updatedAt}`,
        // ⚠ IT COSTS NO ROUND TRIP: `resolveChannelOr` above already fetched
        // the row. `op="read"` is DELIBERATELY left without it — that is the
        // poll-loop path and skips the channel resolve on purpose
        // (`channel-ops-read.ts › opRead`), and buying one line of metadata with
        // a second round trip on every hold is the trade that file exists to
        // refuse.
        ...descriptionLine(channel.topic),
        ...renderCard(channel.infoCard ?? EMPTY_CARD),
        "",
        `⚠ The card is REPLACED WHOLE on a write. To add a row, re-issue op="rooms" action="update" with \`info_card\` carrying EVERY row above plus the new one — a write that omits a row deletes it. Send \`info_card={}\` to clear the card deliberately.`,
      ].join("\n"),
    );
  }

  const patch: ChannelUpdateInput = {};
  if (arg.name !== undefined) patch.name = arg.name.trim();
  if (arg.description !== undefined) patch.topic = arg.description;
  if (card !== undefined) {
    const built = toCard(card);
    if ("isError" in built && built.isError) return built as ToolResponse;
    patch.infoCard = built as ChannelInfoCard;
  }

  let updated;
  try {
    updated = await client.updateChannel(channel.id, patch);
  } catch (e) {
    // A header write is MANAGE-gated; a card write is membership-gated and keeps its own 403.
    if (header && isForbidden(e)) {
      return err(
        refusal(
          CHANNEL_MANAGE_REQUIRED,
          `**${label}** was not changed (the info card included — one patch, one gate). Ask the channel's owner or a workspace admin, or drop \`name\`/\`summary\` to write the card alone.`,
        ),
      );
    }
    throw e;
  }
  const lines = [
    `Updated **${inlineOr(updated.name, NO_NAME)}**: ${Object.keys(patch).map((k) => (k === "topic" ? "description" : k === "infoCard" ? "info card" : k)).join(", ")}. ${headerFacts(updated)}`,
  ];
  if (patch.infoCard !== undefined) {
    lines.push(
      ...renderCard(updated.infoCard ?? patch.infoCard),
      "",
      `⚠ Everyone in this channel sees this card. It changes no permission, no roster and no fact — hiding the Email row hides a ROW, it does not clear anybody's address.`,
    );
  }
  return ok(lines.join("\n"));
}
