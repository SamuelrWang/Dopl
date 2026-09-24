/**
 * `searchKnowledgeEntries` across containers (1.37.1, live test #5): in a home
 * channel `listBases` admits the caller's Home-space bases too, but the RPC is
 * keyed to ONE workspace, so a search of the channel alone missed every Home
 * entry. One RPC per container the readable bases live in, merged by rank.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: () => ({ rpc }) }));
vi.mock("./embeddings", () => ({ embedQuery: vi.fn(async () => null) }));
vi.mock("./service", () => ({ listBases: vi.fn() }));
vi.mock("./repository", () => ({ listFoldersForBase: vi.fn(async () => []) }));

import { listBases } from "./service";
import { searchKnowledgeEntries } from "./search";
import { KnowledgeBaseNotFoundError } from "./errors";
import type { KnowledgeContext } from "../types";

const CHANNEL = "ws-channel";
const HOME = "ws-home";
const ctx = { workspaceId: CHANNEL } as KnowledgeContext;

const base = (id: string, workspaceId: string, slug = id) =>
  ({ id, workspaceId, slug }) as Awaited<ReturnType<typeof listBases>>[number];

const row = (entry: string, baseId: string, rank: number) => ({
  entry_id: entry,
  knowledge_base_id: baseId,
  folder_id: null,
  title: entry,
  excerpt: null,
  snippet: "",
  rank,
  updated_at: "2026-09-24T00:00:00Z",
});

beforeEach(() => {
  rpc.mockReset();
  vi.mocked(listBases).mockResolvedValue([base("b-chan", CHANNEL), base("b-home", HOME, "notes")]);
  rpc.mockImplementation(async (_fn: string, args: { p_workspace_id: string }) => ({
    data: args.p_workspace_id === HOME ? [row("home-hit", "b-home", 0.9)] : [row("chan-hit", "b-chan", 0.4)],
    error: null,
  }));
});

describe("searchKnowledgeEntries — every container a readable base lives in", () => {
  it("finds a Home-space entry from a home channel, ranked with the channel's", async () => {
    const hits = await searchKnowledgeEntries(ctx, "rules");
    expect(rpc.mock.calls.map((c) => c[1].p_workspace_id).sort()).toEqual([CHANNEL, HOME]);
    expect(hits.map((h) => h.entryId)).toEqual(["home-hit", "chan-hit"]);
    expect(hits[0].baseSlug).toBe("notes");
  });

  it("keeps the best `limit` across containers", async () => {
    const hits = await searchKnowledgeEntries(ctx, "rules", { limit: 1 });
    expect(hits.map((h) => h.entryId)).toEqual(["home-hit"]);
  });

  it("resolves a Home base by slug and searches its container only", async () => {
    await searchKnowledgeEntries(ctx, "rules", { baseSlug: "notes" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_workspace_id: HOME, p_base_id: "b-home" });
  });

  it("refuses a slug no readable base carries", async () => {
    await expect(searchKnowledgeEntries(ctx, "rules", { baseSlug: "nope" })).rejects.toBeInstanceOf(
      KnowledgeBaseNotFoundError
    );
  });

  it("drops a row from a base the caller cannot read", async () => {
    rpc.mockResolvedValue({ data: [row("stranger", "b-other", 1)], error: null });
    expect(await searchKnowledgeEntries(ctx, "rules")).toEqual([]);
  });
});
