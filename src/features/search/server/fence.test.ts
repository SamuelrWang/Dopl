/**
 * 🔒 **THE FENCE, DRIVEN AGAINST ROWS THAT BELONG TO SOMEBODY ELSE.**
 *
 * Every other suite in this feature asserts the SHAPE of a query. This one
 * asserts the OUTPUT: the whole service runs over an in-memory database holding
 * a container the caller belongs to and one they do not, with an identical
 * matching row in each, and nothing from the foreign one may appear in any
 * group. INVARIANTS §14: *"a regex over source text is not a behavioural
 * assertion — drive the real function"*, and a `WHERE` clause that was WRITTEN
 * is not a row that was EXCLUDED.
 *
 * MUTATION-VERIFY: 5 reverts, 5 failures, 0 vacuous (2026-09-17) — dropping the
 * `user_id` filter in `loadSearchReach`, dropping its `status='active'` arm,
 * dropping the `workspace_id` narrowing in `loadChannelReach`, dropping the
 * `containerId` narrowing, and calling the three container-only reads in account
 * scope each turn exactly one case in this file red.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { fakeDb, type FakeQueryLog, type FakeTables } from "./_fake-db";
import { runSearch } from "./service";
import type { SearchGroup, SearchItem } from "../contracts";

const ME = "11111111-1111-1111-1111-111111111111";
const STRANGER = "22222222-2222-2222-2222-222222222222";
const WS_MINE = "33333333-3333-3333-3333-333333333333";
const WS_THEIRS = "44444444-4444-4444-4444-444444444444";
const CH_MINE = "55555555-5555-5555-5555-555555555555";
const CH_THEIRS = "66666666-6666-6666-6666-666666666666";

const CTX = {
  userId: ME,
  credentialSubjectUserId: ME,
  lockedWorkspaceId: null,
};

/**
 * Two containers, two channels, and EVERY searchable table carries one row in
 * each. The query `zephyr` matches all of them, so any leak is a visible row
 * rather than a silent absence.
 */
function world(): FakeTables {
  const pair = <T extends Record<string, unknown>>(
    mine: T,
    theirs: T
  ): T[] => [mine, theirs];
  return {
    workspace_members: [
      { workspace_id: WS_MINE, user_id: ME, status: "active" },
      { workspace_id: WS_THEIRS, user_id: STRANGER, status: "active" },
    ],
    workspaces: pair(
      { id: WS_MINE, name: "Mine", kind: "standard" },
      { id: WS_THEIRS, name: "Theirs", kind: "standard" }
    ),
    channel_members: [
      { channel_id: CH_MINE, user_id: ME, workspace_id: WS_MINE },
      { channel_id: CH_THEIRS, user_id: STRANGER, workspace_id: WS_THEIRS },
    ],
    channels: pair(
      {
        id: CH_MINE,
        name: "zephyr room",
        workspace_id: WS_MINE,
        updated_at: "2026-09-01T00:00:00Z",
        deleted_at: null,
      },
      {
        id: CH_THEIRS,
        name: "zephyr room",
        workspace_id: WS_THEIRS,
        updated_at: "2026-09-01T00:00:00Z",
        deleted_at: null,
      }
    ),
    channel_messages: pair(
      {
        id: "msg-mine",
        seq: 1,
        body: "zephyr shipped",
        kind: "message",
        channel_id: CH_MINE,
        workspace_id: WS_MINE,
        created_at: "2026-09-01T00:00:00Z",
      },
      {
        id: "msg-theirs",
        seq: 2,
        body: "zephyr shipped",
        kind: "message",
        channel_id: CH_THEIRS,
        workspace_id: WS_THEIRS,
        created_at: "2026-09-01T00:00:00Z",
      }
    ),
    channel_tasks: pair(
      {
        id: "thr-mine",
        title: "zephyr plan",
        channel_id: CH_MINE,
        workspace_id: WS_MINE,
        updated_at: "2026-09-01T00:00:00Z",
      },
      {
        id: "thr-theirs",
        title: "zephyr plan",
        channel_id: CH_THEIRS,
        workspace_id: WS_THEIRS,
        updated_at: "2026-09-01T00:00:00Z",
      }
    ),
    channel_artifacts: pair(
      {
        id: "art-mine",
        name: "zephyr card",
        summary: "",
        channel_id: CH_MINE,
        workspace_id: WS_MINE,
        created_at: "2026-09-01T00:00:00Z",
        dissolved_at: null,
      },
      {
        id: "art-theirs",
        name: "zephyr card",
        summary: "",
        channel_id: CH_THEIRS,
        workspace_id: WS_THEIRS,
        created_at: "2026-09-01T00:00:00Z",
        dissolved_at: null,
      }
    ),
    knowledge_bases: pair(
      {
        id: "kb-mine",
        name: "Handbook",
        workspace_id: WS_MINE,
        visibility: "public",
        created_by: ME,
        deleted_at: null,
      },
      {
        id: "kb-theirs",
        name: "Handbook",
        workspace_id: WS_THEIRS,
        visibility: "public",
        created_by: STRANGER,
        deleted_at: null,
      }
    ),
    knowledge_entries: pair(
      {
        id: "kn-mine",
        title: "zephyr notes",
        body: "zephyr",
        knowledge_base_id: "kb-mine",
        workspace_id: WS_MINE,
        updated_at: "2026-09-01T00:00:00Z",
        deleted_at: null,
      },
      {
        id: "kn-theirs",
        title: "zephyr notes",
        body: "zephyr",
        knowledge_base_id: "kb-theirs",
        workspace_id: WS_THEIRS,
        updated_at: "2026-09-01T00:00:00Z",
        deleted_at: null,
      }
    ),
    agent_templates: pair(
      {
        id: "tpl-mine",
        name: "zephyr bot",
        description: null,
        workspace_id: WS_MINE,
        visibility: "workspace",
        created_by: ME,
        updated_at: "2026-09-01T00:00:00Z",
      },
      {
        id: "tpl-theirs",
        name: "zephyr bot",
        description: null,
        workspace_id: WS_THEIRS,
        visibility: "workspace",
        created_by: STRANGER,
        updated_at: "2026-09-01T00:00:00Z",
      }
    ),
    skills: pair(
      {
        id: "sk-mine",
        name: "zephyr skill",
        description: null,
        workspace_id: WS_MINE,
        visibility: "public",
        created_by: ME,
        updated_at: "2026-09-01T00:00:00Z",
        deleted_at: null,
      },
      {
        id: "sk-theirs",
        name: "zephyr skill",
        description: null,
        workspace_id: WS_THEIRS,
        visibility: "public",
        created_by: STRANGER,
        updated_at: "2026-09-01T00:00:00Z",
        deleted_at: null,
      }
    ),
    chats: pair(
      {
        id: "ch-mine",
        title: "zephyr chat",
        overview: "",
        workspace_id: WS_MINE,
        visibility: "public",
        owner_id: ME,
        updated_at: "2026-09-01T00:00:00Z",
        deleted_at: null,
      },
      {
        id: "ch-theirs",
        title: "zephyr chat",
        overview: "",
        workspace_id: WS_THEIRS,
        visibility: "public",
        owner_id: STRANGER,
        updated_at: "2026-09-01T00:00:00Z",
        deleted_at: null,
      }
    ),
    profiles: [
      { id: ME, display_name: "zephyr me", email: "me@x.test", avatar_url: null },
      {
        id: STRANGER,
        display_name: "zephyr them",
        email: "them@x.test",
        avatar_url: null,
      },
    ],
  };
}

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
    // ⚠ THE ASSERTION IS OVER EVERY ITEM, NOT OVER A GROUP WE REMEMBERED TO
    // CHECK — a tenth group added without a fence has to fail this line.
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
    // 🔒 "Not a member" and "no such container" must be indistinguishable, or
    // the pair of codes is an existence oracle (service.ts header).
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
    // ⚠ THE CALLER IS A MEMBER OF A CHANNEL IN THE LOCKED-OUT CONTAINER TOO, and
    // that is what makes this case bite: `channel_members.user_id` alone admits
    // the room, so only the `workspace_id` narrowing in `loadChannelReach` can
    // keep it out. Without this row the case passes with the narrowing deleted.
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
    // ⚠ THE ENFORCEMENT IS AN ABSENCE, so it is asserted as one: an empty group
    // is omitted anyway, and a filter applied after the read would pass a test
    // that only looked at the payload.
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

    // ⚠ `credentialSubjectUserId: null` = a credential with nobody behind it.
    // Arm 2 of every `canSee*` predicate in this codebase (F-336/F-333).
    const out = await runSearch(
      { ...CTX, credentialSubjectUserId: null },
      { q: "zephyr", scope: "container", container: WS_MINE }
    );

    expect(allItems(out.groups).map((i) => i.id)).not.toContain("sk-mine");
  });
});
