/**
 * `dopl_channel(op="rooms", action="update")` — NAME and DESCRIPTION (DMP-001, 2026-09-23).
 *
 * The Info tab saves both through `PATCH /api/channels/{id}`; an agent reaches the
 * same outcome here. The server's manage gate (`canManageChannel`) is the fence —
 * this suite pins that a 403 comes back NAMED, that the result carries the
 * canonical facts, and that a param the action does not take is refused.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";

import { registerChannelTool } from "./channel";
import { callTool, stub } from "./narration-fixtures";

const CHANNEL = {
  id: "ch-1",
  workspaceId: "ws-1",
  slug: "launch",
  name: "Launch",
  topic: "Old description",
  visibility: "private" as const,
  createdBy: "u1",
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  infoCard: { hidden: [], rows: [] },
};

const channelStub = (over: Record<string, unknown> = {}) =>
  stub({
    listChannels: vi.fn(async () => [CHANNEL]),
    getChannel: vi.fn(async () => CHANNEL),
    updateChannel: vi.fn(async (_id: string, patch: Record<string, unknown>) => ({
      ...CHANNEL,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.topic !== undefined ? { topic: patch.topic } : {}),
      updatedAt: "2026-09-23T10:00:00Z",
    })),
    ...over,
  });

const run = (client: DoplClient, args: Record<string, unknown>) =>
  callTool(registerChannelTool, client, "dopl_channel", args);

describe("rename + describe", () => {
  it("sends name and topic in ONE patch and returns id, name, description, updated time", async () => {
    const client = channelStub();
    const text = await run(client, {
      op: "rooms",
      action: "update",
      channel: "launch",
      name: "Launch Plan",
      summary: "Everything for the launch",
    });
    expect(client.updateChannel).toHaveBeenCalledWith("ch-1", {
      name: "Launch Plan",
      topic: "Everything for the launch",
    });
    expect(text).toContain("id=`ch-1`");
    expect(text).toContain("name=`Launch Plan`");
    expect(text).toContain("description=`Everything for the launch`");
    expect(text).toContain("updated=2026-09-23T10:00:00Z");
  });

  it("describe alone leaves the name untouched; \"\" clears the description", async () => {
    const client = channelStub();
    const text = await run(client, {
      op: "rooms",
      action: "update",
      channel: "launch",
      summary: "",
    });
    expect(client.updateChannel).toHaveBeenCalledWith("ch-1", { topic: "" });
    expect(text).toContain("description=`(none)`");
  });

  it("refuses an empty name before sending", async () => {
    const client = channelStub();
    const text = await run(client, {
      op: "rooms",
      action: "update",
      channel: "launch",
      name: "   ",
    });
    expect(client.updateChannel).not.toHaveBeenCalled();
    expect(text).toContain("cannot be empty");
  });

  it("a non-manager gets a NAMED refusal, not a bare 403", async () => {
    const forbidden = Object.assign(new Error("Not allowed to manage this channel"), {
      status: 403,
      code: "CHANNEL_FORBIDDEN",
    });
    const client = channelStub({ updateChannel: vi.fn(async () => { throw forbidden; }) });
    const text = await run(client, {
      op: "rooms",
      action: "update",
      channel: "launch",
      name: "Hijacked",
    });
    expect(text).toContain("reason=manage_required");
    expect(text).toContain("owner or a workspace admin");
    expect(text).toContain("retry=no");
  });

  it("refuses a param the action does not take", async () => {
    const client = channelStub();
    const text = await run(client, {
      op: "rooms",
      action: "update",
      channel: "launch",
      name: "Launch Plan",
      body: "stray",
    });
    expect(client.updateChannel).not.toHaveBeenCalled();
    expect(text).toContain("reason=unused_param");
    expect(text).toContain("does not take: body");
  });

  it("the READ arm reports the canonical facts too", async () => {
    const client = channelStub();
    const text = await run(client, { op: "rooms", action: "update", channel: "launch" });
    expect(client.updateChannel).not.toHaveBeenCalled();
    expect(text).toContain("READ ONLY");
    expect(text).toContain("id=`ch-1`");
    expect(text).toContain("updated=2026-01-01T00:00:00Z");
  });
});
