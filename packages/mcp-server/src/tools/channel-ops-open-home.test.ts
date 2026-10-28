/**
 * A room opened in the Home space becomes a proper home channel (its own `kind='link'` container);
 * the Home space itself holds no channels and the server refuses one there.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import type { WorkspaceDirectory } from "../workspace-directory";
import { opOpen } from "./channel-ops-open";

const HOME = "home-ws";
const TEAM = "team-ws";
const MINTED = {
  channel: { id: "chan-h", slug: "ops", name: "Ops", topic: "Runbooks", workspaceId: "link-ws" },
};

function client(boundTo: string | null): DoplClient {
  return {
    getWorkspaceId: () => boundTo,
    createHomeChannel: vi.fn(async () => MINTED),
    createChannel: vi.fn(async () => ({ id: "chan-p", slug: "ops", name: "Ops", visibility: "private" })),
  } as unknown as DoplClient;
}

function directory(locked: string | null = null): WorkspaceDirectory {
  return {
    lockedWorkspaceId: () => locked,
    containerKindIndex: async () =>
      new Map([
        [HOME, "home"],
        [TEAM, "workspace"],
      ]),
  } as unknown as WorkspaceDirectory;
}

describe("opOpen — a room in the Home space is a home channel", () => {
  it.each([
    ["an unbound outside agent (no container)", null],
    ["a call addressed to the Home space", HOME],
  ])("%s mints a home channel with the asked name and description", async (_label, bound) => {
    const c = client(bound);
    const res = await opOpen(c, directory(), { name: "Ops", topic: "Runbooks" });
    expect(c.createHomeChannel).toHaveBeenCalledWith({ name: "Ops", topic: "Runbooks" });
    expect(c.createChannel).not.toHaveBeenCalled();
    const text = res.content[0].text;
    expect(text).toContain("container: `link-ws`");
    expect(text).toContain("slug: `ops`");
    expect(text).toMatch(/Description: .*Runbooks/);
  });

  it("answers a public ask instead of dropping it: a home channel starts private", async () => {
    const res = await opOpen(client(null), directory(), { name: "Ops", visibility: "public" });
    expect(res.content[0].text).toMatch(/starts private/);
  });

  it("a workspace-bound call keeps the plain channel path", async () => {
    const c = client(TEAM);
    await opOpen(c, directory(), { name: "Ops" });
    expect(c.createChannel).toHaveBeenCalled();
    expect(c.createHomeChannel).not.toHaveBeenCalled();
  });

  it("a container-locked session never mints outside its lock", async () => {
    const c = client(null);
    await opOpen(c, directory(TEAM), { name: "Ops" });
    expect(c.createHomeChannel).not.toHaveBeenCalled();
  });

  it("a direct message keeps its current path", async () => {
    const c = client(null);
    (c as unknown as Record<string, unknown>).listWorkspaceMembers = vi.fn(async () => [
      { userId: "u-peer", displayName: "Peer", email: "p@x" },
    ]);
    await opOpen(c, directory(), { direct: true, member: "u-peer" }).catch(() => null);
    expect(c.createHomeChannel).not.toHaveBeenCalled();
  });
});

describe("opOpen — a home_channel container holds one room", () => {
  const LINK = "link-ws";
  const refusal = Object.assign(new Error("HOME_CHANNEL_HAS_ROOM: one room"), {
    status: 409,
    code: "HOME_CHANNEL_HAS_ROOM",
    apiMessage:
      'This container is a home channel, and a home channel holds exactly one room; it already has it, so nothing was created. To make a new room, create a new home channel: over MCP, dopl_create_workspace(name="...").',
  });

  it("relays the server's refusal (naming dopl_create_workspace), not the slug-race narration", async () => {
    const c = client(LINK);
    (c as unknown as Record<string, unknown>).createChannel = vi.fn(async () => {
      throw refusal;
    });
    const dir = {
      lockedWorkspaceId: () => null,
      containerKindIndex: async () => new Map([[LINK, "home_channel"]]),
    } as unknown as WorkspaceDirectory;
    const res = await opOpen(c, dir, { name: "Dopl (SDK)" });
    const text = res.content[0].text;
    expect(res.isError).toBe(true);
    expect(text).toContain("dopl_create_workspace(name=");
    expect(text).not.toMatch(/transient naming conflict/);
    expect(c.createHomeChannel).not.toHaveBeenCalled();
  });
});
