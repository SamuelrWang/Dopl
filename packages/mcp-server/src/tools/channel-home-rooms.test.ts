/**
 * Channels from the HOME SPACE. Home holds no channels since 1.37.1 (each home
 * channel is its own `link` container), so an unbound connection's list was always
 * "No channels yet. Create one…" — a false negative that nudged duplicates — and
 * every channel ref 404'd there. These pin the list and the ref routing.
 */

import { describe, it, expect, vi } from "vitest";
import type { Channel, DoplClient, WorkspaceListItem } from "@dopl/client";
import { workspaceContext } from "@dopl/client";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { opList, opRead } from "./channel-ops-read";
import { routeHomeChannel } from "./channel-home-rooms";
import { ok } from "./respond";

const ws = (id: string, slug: string, kind: "home" | "link" | "standard"): WorkspaceListItem =>
  ({
    id,
    slug,
    name: slug,
    kind,
    ownerId: "u-1",
    publicId: `pub-${id}`,
    description: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    role: "owner",
  }) as WorkspaceListItem;

const HOME = ws("home-1", "home-x", "home");
const LINK_A = ws("link-a", "glasses", "link");
const LINK_B = ws("link-b", "site", "link");
const FIDARIS = ws("ws-f", "fidaris", "standard");

const chan = (id: string, slug: string, container: WorkspaceListItem): Channel =>
  ({
    id,
    slug,
    name: slug,
    visibility: "private",
    container: { id: container.id, kind: container.kind, segment: `${container.slug}-x` },
  }) as unknown as Channel;

const GLASSES = chan("c-glasses", "ai-glasses-mcp", LINK_A);
const SITE = chan("c-site", "personal-website", LINK_B);
const WS_CHAN = chan("c-ws", "general", FIDARIS);

function directory(locked: string | null = null): WorkspaceDirectory {
  const rows = [HOME, LINK_A, LINK_B, FIDARIS];
  return {
    getWorkspaceList: async () => rows,
    lockedWorkspaceId: () => locked,
    containerKindIndex: async () =>
      new Map(
        rows.map((w) => [
          w.id,
          w.kind === "link" ? "home_channel" : w.kind === "home" ? "home" : "workspace",
        ]),
      ),
  } as unknown as WorkspaceDirectory;
}

function client(
  channels: Channel[],
  bound: string | null = null,
  extra: Record<string, unknown> = {},
): DoplClient {
  return {
    getWorkspaceId: () => bound,
    listChannels: vi.fn(async () => []),
    getHomeChannels: vi.fn(async () => ({ channels })),
    ...extra,
  } as unknown as DoplClient;
}

const text = (r: { content: { text: string }[] }) => r.content[0].text;

describe("opList from the Home space", () => {
  it("lists home channels instead of claiming there are none (the regression)", async () => {
    const out = text(await opList(client([GLASSES, SITE, WS_CHAN]), directory()));
    expect(out).not.toContain("No channels yet");
    expect(out).toContain("## Home channels — 2");
    expect(out).toContain("`ai-glasses-mcp`");
    expect(out).toContain("`c-site`");
    // A workspace channel is not a home channel row…
    expect(out).not.toContain("`c-ws`");
    // …but the workspaces holding channels are named in one line.
    expect(out).toContain("Workspace channels — list with container=<slug>: `fidaris` (1).");
  });

  it("says no home channels — never 'create one' — when only workspaces hold channels", async () => {
    const out = text(await opList(client([WS_CHAN]), directory()));
    expect(out).toContain("No home channels.");
    expect(out).not.toContain("Create one");
    expect(out).toContain("`fidaris` (1)");
  });

  it("offers create only when the caller is in no channel at all", async () => {
    const out = text(await opList(client([]), directory()));
    expect(out).toContain("No channels yet. Create one");
  });

  it("a locked session lists its own container, never the account", async () => {
    const c = client([GLASSES]);
    await opList(c, directory("link-a"));
    expect(c.getHomeChannels).not.toHaveBeenCalled();
    expect(c.listChannels).toHaveBeenCalled();
  });

  it("a connection bound to a workspace keeps the container list", async () => {
    const c = client([GLASSES], "ws-f");
    const out = text(await opList(c, directory()));
    expect(c.getHomeChannels).not.toHaveBeenCalled();
    expect(out).toContain("No channels yet");
  });
});

describe("routeHomeChannel — a ref from Home reaches the container that owns it", () => {
  it("runs the op inside the owning container, by slug or by id", async () => {
    for (const ref of ["ai-glasses-mcp", "c-glasses"]) {
      let seen: string | undefined;
      await routeHomeChannel(client([GLASSES, SITE]), directory(), ref, async () => {
        seen = workspaceContext.getStore();
        return ok("");
      });
      expect(seen).toBe("link-a");
    }
  });

  it("a read from Home hits the channel's own container", async () => {
    let seen: string | undefined;
    const readChannelMessages = vi.fn(async () => {
      seen = workspaceContext.getStore();
      return [];
    });
    const c = client([GLASSES], null, { readChannelMessages });
    const res = await routeHomeChannel(c, directory(), "ai-glasses-mcp", () =>
      opRead(c, "ai-glasses-mcp"),
    );
    expect(res.isError).toBeFalsy();
    expect(seen).toBe("link-a");
  });

  it("refuses a slug two home channels share, naming both ids", async () => {
    const twin = chan("c-twin", "ai-glasses-mcp", LINK_B);
    const run = vi.fn(async () => ok(""));
    const res = await routeHomeChannel(client([GLASSES, twin]), directory(), "ai-glasses-mcp", run);
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("`c-glasses`");
    expect(text(res)).toContain("`c-twin`");
    expect(run).not.toHaveBeenCalled();
  });

  it("an unknown ref runs unchanged, and so does any call not landing in Home", async () => {
    let seen: string | undefined = "unset";
    await routeHomeChannel(client([GLASSES]), directory(), "nope", async () => {
      seen = workspaceContext.getStore();
      return ok("");
    });
    expect(seen).toBeUndefined();

    const bound = client([GLASSES], "ws-f");
    await routeHomeChannel(bound, directory(), "ai-glasses-mcp", async () => ok(""));
    expect(bound.getHomeChannels).not.toHaveBeenCalled();
  });
});
