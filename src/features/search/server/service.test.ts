/**
 * The payload's own rules — the ones a fence test cannot see, because they are
 * about SHAPE rather than which rows came back.
 *
 *  - A too-short query is a 200 with no groups and no queries.
 *  - Per-group cap 8, `total` capped at 50 and never the item count.
 *  - A group with no items is omitted, since the popup draws a header for every
 *    group it is handed.
 *  - Section order is `SEARCH_GROUP_ORDER`, not resolution order: iterating the
 *    results would make it a race.
 *
 * MUTATION-VERIFY: 4 reverts, 4 failures, 0 vacuous (2026-09-17).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { fakeDb, type FakeRow, type FakeTables } from "./_fake-db";
import { runSearch } from "./service";
import {
  SEARCH_GROUP_ITEM_CAP,
  SEARCH_GROUP_ORDER,
  SEARCH_GROUP_TOTAL_CAP,
  SEARCH_MIN_QUERY_LENGTH,
} from "../contracts";

const ME = "11111111-1111-1111-1111-111111111111";
const WS = "33333333-3333-3333-3333-333333333333";
const CH = "55555555-5555-5555-5555-555555555555";

const CTX = { userId: ME, credentialSubjectUserId: ME, lockedWorkspaceId: null };

function base(): FakeTables {
  return {
    workspace_members: [{ workspace_id: WS, user_id: ME, status: "active" }],
    workspaces: [{ id: WS, name: "Mine", kind: "standard" }],
    channel_members: [{ channel_id: CH, user_id: ME, workspace_id: WS }],
    channels: [
      {
        id: CH,
        name: "General",
        workspace_id: WS,
        updated_at: "2026-09-01T00:00:00Z",
        deleted_at: null,
      },
    ],
    channel_messages: [],
    channel_tasks: [],
    channel_artifacts: [],
    knowledge_bases: [],
    knowledge_entries: [],
    agent_templates: [],
    skills: [],
    chats: [],
    profiles: [],
  };
}

function threads(count: number): FakeRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `thr-${String(i).padStart(3, "0")}`,
    title: `zephyr ${i}`,
    channel_id: CH,
    workspace_id: WS,
    updated_at: `2026-09-01T00:00:${String(i).padStart(2, "0")}Z`,
  }));
}

function mount(tables: FakeTables) {
  const { client, queries } = fakeDb(tables);
  vi.mocked(supabaseAdmin).mockReturnValue(client as never);
  return queries;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the minimum query length", () => {
  it("answers 200 with no groups and runs NO query", async () => {
    const queries = mount(base());

    const out = await runSearch(CTX, { q: " a ", scope: "account" });

    expect(out).toMatchObject({ q: "a", scope: "account", groups: [] });
    expect(typeof out.tookMs).toBe("number");
    // The read is skipped, not filtered, which is why this is not a validation
    // failure: it costs nothing.
    expect(queries).toEqual([]);
  });

  it("treats an ABSENT q the same way", async () => {
    mount(base());
    const out = await runSearch(CTX, { scope: "account" });
    expect(out).toMatchObject({ q: "", groups: [] });
  });

  it("searches at exactly the minimum length", async () => {
    const tables = base();
    tables.channel_tasks = [
      {
        id: "thr-1",
        title: "zephyr",
        channel_id: CH,
        workspace_id: WS,
        updated_at: "2026-09-01T00:00:00Z",
      },
    ];
    mount(tables);

    const q = "ze".slice(0, SEARCH_MIN_QUERY_LENGTH);
    const out = await runSearch(CTX, { q, scope: "account" });

    expect(out.groups.map((g) => g.kind)).toEqual(["threads"]);
  });
});

describe("caps", () => {
  it("carries 8 items and a TRUE total below the ceiling", async () => {
    const tables = base();
    tables.channel_tasks = threads(12);
    mount(tables);

    const out = await runSearch(CTX, { q: "zephyr", scope: "account" });
    const group = out.groups.find((g) => g.kind === "threads");

    expect(group?.items).toHaveLength(SEARCH_GROUP_ITEM_CAP);
    // Not `items.length` — the count is what the reader is deciding on.
    expect(group?.total).toBe(12);
  });

  it("reports the ceiling — never more — when there are more", async () => {
    const tables = base();
    tables.channel_tasks = threads(120);
    mount(tables);

    const out = await runSearch(CTX, { q: "zephyr", scope: "account" });
    const group = out.groups.find((g) => g.kind === "threads");

    expect(group?.total).toBe(SEARCH_GROUP_TOTAL_CAP);
    expect(group?.items).toHaveLength(SEARCH_GROUP_ITEM_CAP);
  });
});

describe("the group list", () => {
  it("omits every group with no items", async () => {
    const tables = base();
    tables.channel_tasks = threads(1);
    mount(tables);

    const out = await runSearch(CTX, { q: "zephyr", scope: "account" });

    expect(out.groups.map((g) => g.kind)).toEqual(["threads"]);
    expect(out.groups.every((g) => g.items.length > 0)).toBe(true);
  });

  it("orders sections by SEARCH_GROUP_ORDER, not by which read resolved", async () => {
    const tables = base();
    tables.channels[0] = { ...tables.channels[0], name: "zephyr room" };
    tables.channel_messages = [
      {
        id: "m1",
        seq: 7,
        body: "zephyr",
        kind: "message",
        channel_id: CH,
        workspace_id: WS,
        created_at: "2026-09-01T00:00:00Z",
      },
    ];
    tables.channel_tasks = threads(1);
    tables.channel_artifacts = [
      {
        id: "a1",
        name: "zephyr card",
        summary: "",
        channel_id: CH,
        workspace_id: WS,
        created_at: "2026-09-01T00:00:00Z",
        dissolved_at: null,
      },
    ];
    tables.knowledge_bases = [
      {
        id: "kb",
        name: "Handbook",
        workspace_id: WS,
        visibility: "public",
        created_by: ME,
        deleted_at: null,
      },
    ];
    tables.knowledge_entries = [
      {
        id: "k1",
        title: "zephyr notes",
        body: "",
        knowledge_base_id: "kb",
        workspace_id: WS,
        updated_at: "2026-09-01T00:00:00Z",
        deleted_at: null,
      },
    ];
    tables.agent_templates = [
      {
        id: "t1",
        name: "zephyr bot",
        description: null,
        workspace_id: WS,
        visibility: "workspace",
        created_by: ME,
        updated_at: "2026-09-01T00:00:00Z",
      },
    ];
    mount(tables);

    const out = await runSearch(CTX, { q: "zephyr", scope: "account" });

    // Compared against the constant's own order, filtered to what matched: a
    // hand-written literal would drift the day a group is inserted.
    const accountKinds = SEARCH_GROUP_ORDER.filter(
      (k) => !["members", "skills", "chats"].includes(k)
    );
    expect(out.groups.map((g) => g.kind)).toEqual(accountKinds);
  });
});

describe("the item", () => {
  it("titles a message with its channel and carries seq + snippet", async () => {
    const tables = base();
    tables.channel_messages = [
      {
        id: "m1",
        seq: 42,
        body: "we shipped <b>zephyr</b> today",
        kind: "message",
        channel_id: CH,
        workspace_id: WS,
        created_at: "2026-09-01T00:00:00Z",
      },
    ];
    mount(tables);

    const out = await runSearch(CTX, { q: "zephyr", scope: "account" });
    const item = out.groups.find((g) => g.kind === "messages")?.items[0];

    expect(item).toMatchObject({
      id: "m1",
      kind: "messages",
      // A message has no name of its own — the room it was said in is it.
      title: "General",
      containerId: WS,
      containerName: "Mine",
      channelId: CH,
      seq: 42,
    });
    expect(item?.snippet).toBe(
      "we shipped &lt;b&gt;<mark>zephyr</mark>&lt;/b&gt; today"
    );
  });

  it("does not search the task_* narration kinds", async () => {
    const tables = base();
    tables.channel_messages = [
      {
        id: "m1",
        seq: 1,
        body: "zephyr",
        kind: "task_progress",
        channel_id: CH,
        workspace_id: WS,
        created_at: "2026-09-01T00:00:00Z",
      },
    ];
    mount(tables);

    const out = await runSearch(CTX, { q: "zephyr", scope: "account" });

    expect(out.groups).toEqual([]);
  });
});
