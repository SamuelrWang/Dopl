/**
 * An identity's `runtime` (rulings 4–6) and a field's `type` (P7-01) survive the
 * write AND the read. Before P7-01 both normalizers mapped a field to
 * `{key, value}`, so every retype reverted on the next read.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/tenancy/resource-grant-reach", async (orig) =>
  (await import("./service-writes-fixtures")).noGrantsMock(orig)
);
vi.mock("@/shared/tenancy/resolve-resource", async (orig) =>
  (await import("./service-writes-fixtures")).resolveNowhereMock(orig)
);
vi.mock("@/features/workspaces/server/repository", async () =>
  (await import("./service-writes-fixtures")).workspaceRepoMock()
);
vi.mock("@/features/workspaces/server/repository-overview", () => ({
  countActiveMembers: vi.fn().mockResolvedValue(1),
}));
vi.mock("./repository", async () => (await import("./service-writes-fixtures")).repoMock());

import * as repo from "./repository";
import { createIdentity, updateIdentity } from "./service";
import { mapAgentIdentityRow, type AgentIdentityRow } from "./dto";
import { AgentIdentityCreateSchema, AgentIdentityUpdateSchema } from "../schema";
import { ctx, identity, resetRepoMocks } from "./service-writes-fixtures";

const mockRepo = vi.mocked(repo);

beforeEach(() => {
  vi.clearAllMocks();
  resetRepoMocks(mockRepo);
  mockRepo.findIdentityById.mockResolvedValue(identity());
  mockRepo.insertIdentity.mockResolvedValue(identity());
  mockRepo.updateIdentityRow.mockResolvedValue(identity());
});

function row(over: Partial<AgentIdentityRow> = {}): AgentIdentityRow {
  return {
    id: "id-1",
    workspace_id: "ws-1",
    name: "Researcher",
    description: null,
    instructions: null,
    model: null,
    fields: [],
    visibility: "private",
    created_by: "user-owner",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("the field type persists", () => {
  it("is written on create", async () => {
    await createIdentity(ctx(), {
      name: "Researcher",
      fields: [{ key: "Deadline", value: "2026-10-01", type: "date" }],
    });
    expect(mockRepo.insertIdentity.mock.calls[0][0].fields).toEqual([
      { key: "Deadline", value: "2026-10-01", type: "date" },
    ]);
  });

  it("is written on update", async () => {
    await updateIdentity(ctx(), "id-1", {
      fields: [{ key: "Seats", value: "4", type: "number" }, { key: "Tone", value: "terse" }],
    });
    expect(mockRepo.updateIdentityRow.mock.calls[0][2].fields).toEqual([
      { key: "Seats", value: "4", type: "number" },
      { key: "Tone", value: "terse" },
    ]);
  });

  it("is read back, and an unknown type reads as absent (= text)", () => {
    const mapped = mapAgentIdentityRow(
      row({
        fields: [
          { key: "Deadline", value: "2026-10-01", type: "date" },
          { key: "Odd", value: "x", type: "pill" },
          { key: "Plain", value: "y" },
        ],
      })
    );
    expect(mapped.fields).toEqual([
      { key: "Deadline", value: "2026-10-01", type: "date" },
      { key: "Odd", value: "x" },
      { key: "Plain", value: "y" },
    ]);
  });
});

describe("the identity runtime", () => {
  it("is written on create, and absent means null (no preference)", async () => {
    await createIdentity(ctx(), { name: "Coder", model: "gpt-6-sol", runtime: "codex" });
    await createIdentity(ctx(), { name: "Blank" });
    expect(mockRepo.insertIdentity.mock.calls[0][0]).toMatchObject({ model: "gpt-6-sol", runtime: "codex" });
    expect(mockRepo.insertIdentity.mock.calls[1][0]).toMatchObject({ runtime: null });
  });

  it("is set and cleared on update; absent leaves the column alone", async () => {
    await updateIdentity(ctx(), "id-1", { runtime: "codex" });
    await updateIdentity(ctx(), "id-1", { runtime: null });
    await updateIdentity(ctx(), "id-1", { name: "Renamed" });
    const patches = mockRepo.updateIdentityRow.mock.calls.map((c) => c[2]);
    expect(patches[0].runtime).toBe("codex");
    expect(patches[1].runtime).toBeNull();
    expect(patches[2].runtime).toBeUndefined();
  });

  it("is read back, and a row from a stale schema cache reads null", () => {
    expect(mapAgentIdentityRow(row({ runtime: "codex" })).runtime).toBe("codex");
    expect(mapAgentIdentityRow(row()).runtime).toBeNull();
  });

  it("is grammar-checked against the launch runtime-id pattern", () => {
    expect(AgentIdentityUpdateSchema.safeParse({ runtime: "codex" }).success).toBe(true);
    expect(AgentIdentityUpdateSchema.safeParse({ runtime: null }).success).toBe(true);
    expect(AgentIdentityUpdateSchema.safeParse({ runtime: "Codex" }).success).toBe(false);
    expect(AgentIdentityUpdateSchema.safeParse({ runtime: "claude code" }).success).toBe(false);
    expect(AgentIdentityCreateSchema.safeParse({ name: "A", runtime: "" }).success).toBe(false);
  });

  it("counts as a change on its own (a runtime-only PATCH is not empty)", () => {
    expect(AgentIdentityUpdateSchema.safeParse({ runtime: "claude" }).success).toBe(true);
  });
});
