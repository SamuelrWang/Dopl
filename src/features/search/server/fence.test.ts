/**
 * The fence, driven against rows that belong to somebody else. Other suites here
 * assert the SHAPE of a query; this asserts the OUTPUT — the whole service runs
 * over an in-memory database holding one container the caller belongs to and one
 * they do not, with an identical matching row in each (INVARIANTS §14).
 *
 * The world lives in `_fake-world.ts` because `prefix-match.test.ts` (F-717)
 * asserts a widening over the same rows, so a widening that leaked fails here.
 *
 * MUTATION-VERIFY: 5 reverts, 5 failures, 0 vacuous (2026-09-17).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { fakeDb, type FakeQueryLog, type FakeTables } from "./_fake-db";
import {
  CH_MINE,
  CH_THEIRS,
  CTX,
  ME,
  STRANGER,
  WS_MINE,
  WS_THEIRS,
  world,
} from "./_fake-world";
import { runSearch } from "./service";
import type { SearchGroup, SearchItem } from "../contracts";

function mount(tables: FakeTables = world()): FakeQueryLog[] {
  const { client, queries } = fakeDb(tables);
  vi.mocked(supabaseAdmin).mockReturnValue(client as never);
  return queries;
}

const allItems = (groups: SearchGroup[]): SearchItem[] =>
  groups.flatMap((g) => g.items);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("🔒 a non-member sees NOTHING from a container", () => {
  it("returns no row, in any group, from a container the caller is not in", async () => {
    mount();

    const out = await runSearch(CTX, { q: "zephyr", scope: "account" });

    const items = allItems(out.groups);
    expect(items.length).toBeGreaterThan(0);
    // Over EVERY item, not a group we remembered to check: a tenth group added
    // without a fence has to fail this line.
    for (const item of items) {
      expect(item.containerId).toBe(WS_MINE);
      if (item.channelId !== undefined) expect(item.channelId).toBe(CH_MINE);
      expect(item.id.endsWith("theirs")).toBe(false);
    }
    expect(items.some((i) => i.containerName === "Theirs")).toBe(false);
  });

  it("403s a container the caller is not a member of", async () => {
    mount();
    await expect(
      runSearch(CTX, { q: "zephyr", scope: "container", container: WS_THEIRS })
    ).rejects.toMatchObject({ status: 403, code: "SEARCH_CONTAINER_FORBIDDEN" });
  });

  it("answers a container that does not exist with the SAME 403", async () => {
    mount();
    // "Not a member" and "no such container" must be indistinguishable, or the
    // pair of codes is an existence oracle (service.ts header).
    await expect(
      runSearch(CTX, {
        q: "zephyr",
        scope: "container",
        container: "99999999-9999-9999-9999-999999999999",
      })
    ).rejects.toMatchObject({ status: 403, code: "SEARCH_CONTAINER_FORBIDDEN" });
  });

  it("drops a membership whose status is not active", async () => {
    const tables = world();
    (tables.workspace_members[0] as { status: string }).status = "revoked";
    mount(tables);

    const out = await runSearch(CTX, { q: "zephyr", scope: "account" });

    expect(out.groups).toEqual([]);
  });

  it("narrows to ONE container under a locked credential", async () => {
    const tables = world();
    tables.workspace_members.push({
      workspace_id: WS_THEIRS,
      user_id: ME,
      status: "active",
    });
    // The caller is a member of a channel in the locked-out container too, which
    // is what makes this bite: `channel_members.user_id` alone admits the room, so
    // only `loadChannelReach`'s `workspace_id` narrowing keeps it out.
    tables.channel_members.push({
      channel_id: CH_THEIRS,
      user_id: ME,
      workspace_id: WS_THEIRS,
    });
    mount(tables);

    const out = await runSearch(
      { ...CTX, lockedWorkspaceId: WS_MINE },
      { q: "zephyr", scope: "account" }
    );

    for (const item of allItems(out.groups)) {
      expect(item.containerId).toBe(WS_MINE);
    }
  });
});

describe("🔒 home scope never returns members / skills / chats", () => {
  it("does not QUERY those tables at all", async () => {
    const queries = mount();

    const out = await runSearch(CTX, { q: "zephyr", scope: "account" });

    expect(out.groups.map((g) => g.kind)).not.toContain("members");
    expect(out.groups.map((g) => g.kind)).not.toContain("skills");
    expect(out.groups.map((g) => g.kind)).not.toContain("chats");
    // The enforcement is an absence, so it is asserted as one: a filter applied
    // after the read would pass a test that only looked at the payload.
    const tables = queries.map((q) => q.table);
    expect(tables).not.toContain("profiles");
    expect(tables).not.toContain("skills");
    expect(tables).not.toContain("chats");
  });

  it("returns all three in container scope on a STANDARD container", async () => {
    mount();

    const out = await runSearch(CTX, {
      q: "zephyr",
      scope: "container",
      container: WS_MINE,
    });

    const kinds = out.groups.map((g) => g.kind);
    expect(kinds).toContain("members");
    expect(kinds).toContain("skills");
    expect(kinds).toContain("chats");
  });

  it("omits all three on a non-standard container, in container scope", async () => {
    const tables = world();
    (tables.workspaces[0] as { kind: string }).kind = "link";
    const queries = mount(tables);

    const out = await runSearch(CTX, {
      q: "zephyr",
      scope: "container",
      container: WS_MINE,
    });

    expect(out.groups.map((g) => g.kind)).toEqual([
      "channels",
      "messages",
      "threads",
      "artifacts",
      "knowledge",
      "agentTemplates",
    ]);
    expect(queries.map((q) => q.table)).not.toContain("profiles");
  });
});

describe("🔒 a private row reaches only its owner", () => {
  it("hides another member's private knowledge base, skill and chat", async () => {
    const tables = world();
    tables.workspace_members.push({
      workspace_id: WS_MINE,
      user_id: STRANGER,
      status: "active",
    });
    tables.knowledge_bases.push({
      id: "kb-secret",
      name: "Secret",
      workspace_id: WS_MINE,
      visibility: "private",
      created_by: STRANGER,
      deleted_at: null,
    });
    tables.knowledge_entries.push({
      id: "kn-secret",
      title: "zephyr secret",
      body: "zephyr",
      knowledge_base_id: "kb-secret",
      workspace_id: WS_MINE,
      updated_at: "2026-09-02T00:00:00Z",
      deleted_at: null,
    });
    tables.skills.push({
      id: "sk-secret",
      name: "zephyr secret",
      description: null,
      workspace_id: WS_MINE,
      visibility: "private",
      created_by: STRANGER,
      updated_at: "2026-09-02T00:00:00Z",
      deleted_at: null,
    });
    tables.chats.push({
      id: "chat-secret",
      title: "zephyr secret",
      overview: "",
      workspace_id: WS_MINE,
      visibility: "private",
      owner_id: STRANGER,
      updated_at: "2026-09-02T00:00:00Z",
      deleted_at: null,
    });
    mount(tables);

    const out = await runSearch(CTX, {
      q: "zephyr",
      scope: "container",
      container: WS_MINE,
    });

    expect(allItems(out.groups).map((i) => i.id)).not.toContain("kn-secret");
    expect(allItems(out.groups).map((i) => i.id)).not.toContain("sk-secret");
    expect(allItems(out.groups).map((i) => i.id)).not.toContain("chat-secret");
  });

  it("reaches the caller's OWN private rows", async () => {
    const tables = world();
    (tables.skills[0] as { visibility: string }).visibility = "private";
    mount(tables);

    const out = await runSearch(CTX, {
      q: "zephyr",
      scope: "container",
      container: WS_MINE,
    });

    expect(allItems(out.groups).map((i) => i.id)).toContain("sk-mine");
  });

  it("🔒 drops the own-row arm for a SHARED credential", async () => {
    const tables = world();
    (tables.skills[0] as { visibility: string }).visibility = "private";
    mount(tables);

    // `credentialSubjectUserId: null` is a credential with nobody behind it —
    // arm 2 of every `canSee*` predicate (F-336/F-333).
    const out = await runSearch(
      { ...CTX, credentialSubjectUserId: null },
      { q: "zephyr", scope: "container", container: WS_MINE }
    );

    expect(allItems(out.groups).map((i) => i.id)).not.toContain("sk-mine");
  });
});
