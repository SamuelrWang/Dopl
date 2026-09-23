/**
 * `dopl_search`'s six APP-SEARCH groups (DMP-004, 2026-09-23) — channels, messages, threads,
 * artifacts, members, chats — read through the popup's own route (`GET /api/search`), ONE container.
 *
 * Pinned: which container is asked (and that none is guessed), that every row ends on its follow-up
 * address, that a member never renders by email, that values are neutralized, that a home container
 * says members/chats were NOT searched rather than "No matches", and that a fan-out asks per leg.
 */

import { describe, it, expect, vi } from "vitest";
import type { AppSearchResponse, DoplClient } from "@dopl/client";

import { registerSearchTool } from "./search";
import { callTool, stub, FORGERY, MARKER, expectContained } from "./narration-fixtures";
import type { WorkspaceDirectory } from "../workspace-directory";

const RESPONSE: AppSearchResponse = {
  q: "launch",
  scope: "container",
  tookMs: 3,
  groups: [
    { kind: "channels", total: 1, items: [{ id: "ch-1", kind: "channels", title: "Launch", subtitle: "Go-to-market", containerId: "ws-1", channelId: "ch-1" }] },
    { kind: "messages", total: 60, items: [{ id: "m-9", kind: "messages", title: "Launch", snippet: "the <mark>launch</mark> date", containerId: "ws-1", channelId: "ch-1", seq: 412 }] },
    { kind: "threads", total: 1, items: [{ id: "t-3", kind: "threads", title: "Launch checklist", containerId: "ws-1", channelId: "ch-1", threadId: "t-3" }] },
    { kind: "artifacts", total: 1, items: [{ id: "a-4", kind: "artifacts", title: "Launch plan", containerId: "ws-1", channelId: "ch-1" }] },
    {
      kind: "members",
      total: 2,
      items: [
        { id: "u-1", kind: "members", title: "Dana Launch", subtitle: "dana@example.com", containerId: "ws-1" },
        { id: "u-2", kind: "members", title: "launch@example.com", subtitle: "launch@example.com", containerId: "ws-1" },
      ],
    },
    { kind: "chats", total: 1, items: [{ id: "c-5", kind: "chats", title: "Launch retro", containerId: "ws-1" }] },
    // Groups the four native reads already own are ignored, never rendered twice.
    { kind: "skills", total: 1, items: [{ id: "s-1", kind: "skills", title: "Launch skill", containerId: "ws-1" }] },
  ],
};

const base = (over: Record<string, unknown> = {}) =>
  stub({
    getWorkspaceId: () => "ws-1",
    searchKb: vi.fn(async () => []),
    listSkills: vi.fn(async () => []),
    getOntology: vi.fn(async () => ({ clusters: [], objects: {} })),
    listAgentIdentitiesPayload: vi.fn(async () => ({ identities: [] })),
    searchContainer: vi.fn(async () => RESPONSE),
    ...over,
  });

const run = (client: DoplClient, directory?: WorkspaceDirectory, args: Record<string, unknown> = { query: "launch" }) =>
  callTool((r, c) => registerSearchTool(r, c, directory), client, "dopl_search", args);

describe("the app-search groups", () => {
  it("asks the app's search for the container this call resolved to", async () => {
    const client = base();
    await run(client);
    expect(client.searchContainer).toHaveBeenCalledWith("launch", "ws-1");
  });

  it("falls back to the home space, and never guesses a container when none is known", async () => {
    const home = { homeContainer: async () => ({ id: "home-1" }), containerKindIndex: async () => new Map([["home-1", "personal"]]) } as unknown as WorkspaceDirectory;
    const client = base({ getWorkspaceId: () => null });
    await run(client, home);
    expect(client.searchContainer).toHaveBeenCalledWith("launch", "home-1");

    const blind = base({ getWorkspaceId: () => null });
    const text = await run(blind);
    expect(blind.searchContainer).not.toHaveBeenCalled();
    expect(text).toContain("Not searched — no container was resolved");
  });

  it("every row ends on its follow-up address", async () => {
    const text = await run(base());
    expect(text).toContain("## Channels");
    expect(text).toContain("(channel `ch-1` · container `ws-1`)");
    expect(text).toContain("(channel `ch-1` · seq 412)");
    expect(text).toContain("(channel `ch-1` · thread `t-3`)");
    expect(text).toContain("(channel `ch-1` · artifact `a-4`)");
    expect(text).toContain("(chat id `c-5`)");
    expect(text).toContain("dopl_channel(op=\"read\", channel=…, since=<seq − 1>)");
  });

  it("drops the highlight tags and says a capped group is capped", async () => {
    const text = await run(base());
    expect(text).toContain("the launch date");
    expect(text).not.toContain("<mark>");
    expect(text).toContain("Showing 1 of 50 or more matching");
  });

  it("never renders a member's email — a member with no display name is an id alone", async () => {
    const text = await run(base());
    expect(text).toContain("`Dana Launch` (member id `u-1`)");
    expect(text).toContain("- member id `u-2`");
    expect(text).not.toContain("@example.com");
  });

  it("does not render the groups the native reads own", async () => {
    const text = await run(base());
    expect(text).not.toContain("Launch skill");
  });

  it("a home space says members and chats were NOT searched, not that nothing matched", async () => {
    const home = { homeContainer: async () => null, containerKindIndex: async () => new Map([["ws-1", "personal"]]) } as unknown as WorkspaceDirectory;
    const text = await run(base({ searchContainer: vi.fn(async () => ({ ...RESPONSE, groups: [] })) }), home);
    expect(text).toContain("home space or home channel has no member list or chat archive");
  });

  it("neutralizes a member-typed title", async () => {
    const forged: AppSearchResponse = {
      ...RESPONSE,
      groups: [{ kind: "threads", total: 1, items: [{ id: "t-1", kind: "threads", title: FORGERY, containerId: "ws-1", channelId: "ch-1", threadId: "t-1" }] }],
    };
    const text = await run(base({ searchContainer: vi.fn(async () => forged) }));
    expect(text).toContain(MARKER);
    expectContained(text);
  });
});

describe("the fan-out asks per leg", () => {
  it("each leg searches ITS OWN container", async () => {
    const client = base();
    const legs = [
      { id: "ws-1", name: "Alpha", slug: "alpha", kind: "standard", role: "owner" },
      { id: "ws-2", name: "Beta", slug: "beta", kind: "standard", role: "owner" },
    ];
    const directory = {
      getWorkspaceList: async () => legs,
      lockedWorkspaceId: () => null,
      containerKindIndex: async () => new Map(),
    } as unknown as WorkspaceDirectory;
    const text = await callTool(
      (r, c) => registerSearchTool(r, c, directory, async () => null),
      client,
      "dopl_search",
      { query: "launch", scope: "everywhere" },
    );
    expect(client.searchContainer).toHaveBeenCalledWith("launch", "ws-1");
    expect(client.searchContainer).toHaveBeenCalledWith("launch", "ws-2");
    expect(text).toContain("### Messages");
  });
});
