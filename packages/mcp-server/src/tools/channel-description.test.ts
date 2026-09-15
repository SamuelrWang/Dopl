/**
 * THE CHANNEL'S **DESCRIPTION** ON THE `dopl_channel` SURFACE.
 *
 * ⚠ **"DESCRIPTION" IS THE PRODUCT'S WORD FOR `channels.topic` (ruling, Samuel,
 * 2026-09-15).** One 2000-char column, one label everywhere — the /home
 * New-channel popup, the workspace create dialog, both Info cards and this tool.
 * **There is no second column and there must not be one**; the wire field stays
 * `topic`, which is why every assertion below feeds `topic` and reads
 * "Description".
 *
 * ⚠ THE GAP THIS CLOSES: the description was rendered ONLY on a listing
 * (`channel-render.ts › formatChannelLine`'s ` — <topic>` tail). An agent that
 * opened a room, or read one room's card, was told everything about it except
 * what it was for.
 *
 * ⚠ `op="read"` IS DELIBERATELY NOT HERE. That is the poll/hold path and it
 * skips `resolveChannelOr` on purpose (`channel-ops-read.ts › opRead`, "hot
 * path"); buying one line of metadata with a second round trip on every hold is
 * the trade that file exists to refuse. The two sites that already HAVE the row
 * in hand are the two that print it.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";

import { registerChannelTool } from "./channel";
import { callTool, stub, FORGERY, MARKER, expectContained } from "./narration-fixtures";

const CHANNEL = {
  id: "ch-1",
  workspaceId: "ws-1",
  slug: "q3-fundraise",
  name: "Q3 Fundraise",
  topic: "Everything about the Series A",
  visibility: "private" as const,
  createdBy: "u1",
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  infoCard: { hidden: [], rows: [] },
};

const run = (client: DoplClient, args: Record<string, unknown>) =>
  callTool(registerChannelTool, client, "dopl_channel", args);

/** `action="open"` — the row comes back from the create itself. */
const openStub = (over: Record<string, unknown> = {}) =>
  stub({ createChannel: vi.fn(async () => CHANNEL), ...over });

/** `action="update"` with no `info_card` — the READ arm. */
const cardStub = (over: Record<string, unknown> = {}) =>
  stub({
    listChannels: vi.fn(async () => [CHANNEL]),
    getChannel: vi.fn(async () => CHANNEL),
    updateChannel: vi.fn(),
    ...over,
  });

describe('rooms action="open" states the description it just stored', () => {
  it("echoes it back under the created-channel line", async () => {
    // ⚠ ECHOED because `summary` carries FOUR meanings on this tool, and a
    // creator who set the wrong one should see which room they actually
    // described.
    const text = await run(openStub(), {
      op: "rooms",
      action: "open",
      name: "Q3 Fundraise",
      summary: "Everything about the Series A",
    });
    expect(text).toContain("Description: `Everything about the Series A`");
  });

  it("prints NO line at all when the room has none", async () => {
    // ⚠ Silent, not empty: `Description: ` with nothing after it is a line that
    // costs characters to say nothing.
    const text = await run(openStub({ createChannel: vi.fn(async () => ({ ...CHANNEL, topic: "" })) }), {
      op: "rooms",
      action: "open",
      name: "Q3 Fundraise",
    });
    expect(text).not.toContain("Description:");
  });

  it("NEUTRALIZES it — the description is peer text one argument old", async () => {
    // ⚠ The same flat rule every other value on this surface gets. Per-site
    // judgement about who could have authored a string is what leaves a
    // peer-typed one raw.
    const text = await run(
      openStub({ createChannel: vi.fn(async () => ({ ...CHANNEL, topic: FORGERY })) }),
      { op: "rooms", action: "open", name: "Q3 Fundraise", summary: FORGERY },
    );
    expectContained(text);
  });
});

describe('rooms action="update" READ arm states the description', () => {
  it("renders it above the card, and writes nothing", async () => {
    const updateChannel = vi.fn();
    const text = await run(cardStub({ updateChannel }), {
      op: "rooms",
      action: "update",
      channel: "q3-fundraise",
    });
    expect(text).toContain("Description: `Everything about the Series A`");
    // ⚠ It costs NO round trip: `resolveChannelOr` already fetched this row.
    expect(updateChannel).not.toHaveBeenCalled();
  });

  it("prints NO line when the room has none", async () => {
    const bare = { ...CHANNEL, topic: "" };
    const text = await run(
      cardStub({ listChannels: vi.fn(async () => [bare]), getChannel: vi.fn(async () => bare) }),
      { op: "rooms", action: "update", channel: "q3-fundraise" },
    );
    expect(text).not.toContain("Description:");
  });

  it("NEUTRALIZES it", async () => {
    const forged = { ...CHANNEL, topic: FORGERY };
    const text = await run(
      cardStub({ listChannels: vi.fn(async () => [forged]), getChannel: vi.fn(async () => forged) }),
      { op: "rooms", action: "update", channel: "q3-fundraise" },
    );
    expect(text).toContain(MARKER);
    expectContained(text);
  });
});
