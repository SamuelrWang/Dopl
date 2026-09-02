/**
 * `dopl_channel(op="rooms", action="update")` — the info card, and the ruling
 * around it.
 *
 * ⚠ THE HEADLINE ASSERTION IS AN ABSENCE. Samuel ruled Q12 (b): `infoCard` ONLY.
 * The same `PATCH` route accepts `name`, `topic` and `archived`, which NO UI can
 * ask for (F-346), and shipping RENAME first on the AGENT surface would leave
 * the operator's only undo as "ask an agent". So this suite pins that the action
 * cannot send them — a widening would otherwise be a one-line change nothing
 * noticed.
 *
 * ⚠ AND THE CARD IS REPLACED WHOLE, which makes a blind write DESTRUCTIVE. The
 * read arm (omit `info_card`) is what makes read-modify-write possible without a
 * second op to gate, classify and describe.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";

import { registerChannelTool } from "./channel";
import { CHANNEL_ACTIONS } from "./channel-schema";
import { callTool, stub } from "./narration-fixtures";

const CHANNEL = {
  id: "ch-1",
  workspaceId: "ws-1",
  slug: "with-dana",
  name: "With Dana",
  topic: "",
  visibility: "private" as const,
  createdBy: "u1",
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  infoCard: {
    hidden: ["email" as const],
    rows: [{ id: "r-1", label: "Deal", value: "Acme renewal" }],
  },
};

const channelStub = (over: Record<string, unknown> = {}) =>
  stub({
    listChannels: vi.fn(async () => [CHANNEL]),
    getChannel: vi.fn(async () => CHANNEL),
    updateChannel: vi.fn(async () => CHANNEL),
    ...over,
  });

const run = (client: DoplClient, args: Record<string, unknown>) =>
  callTool(registerChannelTool, client, "dopl_channel", args);

describe("omitting info_card is the READ", () => {
  it("renders the current card and writes NOTHING", async () => {
    const update = vi.fn();
    const text = await run(channelStub({ updateChannel: update }), {
      op: "rooms",
      action: "update",
      channel: "with-dana",
    });
    expect(update).not.toHaveBeenCalled();
    expect(text).toContain("READ ONLY, nothing was changed");
    expect(text).toContain("Hidden built-in rows: email");
    expect(text).toContain("`Deal`: `Acme renewal`");
    // ⚠ The read has to TEACH the replace-whole rule, or its whole reason for
    // existing (making an append safe) is lost on the caller.
    expect(text).toContain("REPLACED WHOLE");
    expect(text).toContain("a write that omits a row deletes it");
  });

  it("survives an ABSENT infoCard key — an older payload must not throw", async () => {
    // ⚠ §8: the wire type is optional here and non-optional server-side.
    const bare = { ...CHANNEL, infoCard: undefined };
    const text = await run(
      channelStub({
        listChannels: vi.fn(async () => [bare]),
        getChannel: vi.fn(async () => bare),
      }),
      { op: "rooms", action: "update", channel: "with-dana" },
    );
    expect(text).toContain("Hidden built-in rows: none");
    expect(text).toContain("Custom rows: none");
  });
});

describe("passing info_card REPLACES the card", () => {
  it("sends the whole card and mints ids for new rows", async () => {
    const update = vi.fn(async () => CHANNEL);
    await run(channelStub({ updateChannel: update }), {
      op: "rooms",
      action: "update",
      channel: "with-dana",
      info_card: { rows: [{ label: "Owner", value: "Sam" }] },
    });
    const [id, patch] = update.mock.calls[0] as [string, { infoCard: { rows: Array<{ id: string }> } }];
    expect(id).toBe("ch-1");
    expect(patch.infoCard.rows).toHaveLength(1);
    // ⚠ MINTED, not demanded: an agent has no reason to invent an id, and one
    // that does invents collisions the route refuses with a React-keys message.
    expect(patch.infoCard.rows[0].id).toMatch(/[0-9a-f-]{36}/);
  });

  it("`info_card={}` clears the card — the deliberate reset, not a second verb", async () => {
    const update = vi.fn(async () => CHANNEL);
    await run(channelStub({ updateChannel: update }), {
      op: "rooms",
      action: "update",
      channel: "with-dana",
      info_card: {},
    });
    expect(update).toHaveBeenCalledWith("ch-1", {
      infoCard: { hidden: [], rows: [] },
    });
  });

  it("REFUSES an unknown built-in key LOCALLY, naming the three legal ones", async () => {
    const update = vi.fn();
    const text = await run(channelStub({ updateChannel: update }), {
      op: "rooms",
      action: "update",
      channel: "with-dana",
      info_card: { hidden: ["phone"] },
    });
    expect(update).not.toHaveBeenCalled();
    expect(text).toContain("Refused before sending");
    expect(text).toContain("email, created, lastActivity");
  });

  it("REFUSES duplicate row ids locally, with the fix", async () => {
    const update = vi.fn();
    const text = await run(channelStub({ updateChannel: update }), {
      op: "rooms",
      action: "update",
      channel: "with-dana",
      info_card: {
        rows: [
          { id: "r-1", label: "A" },
          { id: "r-1", label: "B" },
        ],
      },
    });
    expect(update).not.toHaveBeenCalled();
    expect(text).toContain("share the id `r-1`");
    expect(text).toContain("omit `id` on a NEW row");
  });

  it("says who sees the card, and that hiding a row clears no data", async () => {
    const text = await run(channelStub(), {
      op: "rooms",
      action: "update",
      channel: "with-dana",
      info_card: { rows: [{ label: "Owner", value: "Sam" }] },
    });
    expect(text).toContain("Everyone in this channel sees this card");
    expect(text).toContain("it does not clear anybody's address");
  });
});

describe("🔒 the fields this op deliberately cannot send", () => {
  it("NEVER puts name / topic / archived / visibility in the patch", async () => {
    // ⚠ THE RULING, PINNED. `name` IS a declared param on this tool
    // (rooms action="open" uses it), `visibility` is too, and `summary` is what
    // carries a room's TOPIC since B8 — so a careless widening of the update arm
    // is one spread away, and the route would accept the fields it maps to.
    const update = vi.fn(async () => CHANNEL);
    await run(channelStub({ updateChannel: update }), {
      op: "rooms",
      action: "update",
      channel: "with-dana",
      name: "Renamed",
      summary: "new topic",
      visibility: "public",
      info_card: { rows: [] },
    });
    const [, patch] = update.mock.calls[0] as [string, Record<string, unknown>];
    expect(Object.keys(patch)).toEqual(["infoCard"]);
  });

  it("the description still names the op that carries it, and the RULING is enforced in code", async () => {
    // ⚠ THE ENFORCEMENT IS THE CASE ABOVE, AND IT IS THE HALF THAT MATTERS: the
    // patch is `["infoCard"]` and nothing else, so a careless widening fails
    // whatever any prose says. This case is the SURFACE half — the call has to be
    // pickable at all.
    //
    // ⚠ **RE-POINTED BY THE FIVE-OP COLLAPSE (B8).** `update` is no longer an
    // OP, so the description no longer carries a `"update"` token for
    // `parity.test.ts` to grep: it is an ACTION under `"rooms"`, and the two
    // halves of "pickable" are now the description naming `"rooms"` and the
    // PUBLISHED schema's `action` enum carrying `update`. Both are asserted, so
    // dropping either still fails here.
    //
    // ⚠ FINDING, REPORTED RATHER THAN WEAKENED (T82, measured 2026-09-02). The
    // sentence "name, topic, archive state and visibility are NOT editable from
    // here" went with the description's ~35k-char trim and landed NOWHERE: it is
    // in no `channel-*.ts`, not in `channel-doctrine.ts`, not in
    // `CHANNEL_INPUT_SHAPE.info_card`'s `.describe()`, and not in `opUpdate`'s
    // own result. That is the one paragraph in this tier that was deleted rather
    // than moved, so there is no second half to pin it against yet — an agent
    // that passes `name` alongside `info_card` is now silently ignored with
    // nothing anywhere telling it why.
    let description = "";
    registerChannelTool(
      ((name: string, d: string) => {
        if (name === "dopl_channel") description = d;
      }) as never,
      stub({}),
    );
    expect(description).toContain('"rooms"');
    expect(CHANNEL_ACTIONS.rooms).toContain("update");
    expect(description).not.toContain("NOT editable from here");
  });
});
