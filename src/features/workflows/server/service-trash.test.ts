/**
 * Unit tests for the workflow trash lifecycle — focused on the purge
 * invariants (the destructive, unrecoverable op). Supabase, the team-access
 * gate, and the repository hard-delete are mocked. Covers:
 *   - purge REFUSES a live row (lookup filters `deleted_at IS NOT NULL`, so a
 *     live/absent workflow resolves to nothing → 404, nothing deleted)
 *   - purge is workspace-scoped (cross-workspace ids can't reach a row)
 *   - purge of a trashed row is edit-gated, then hard-deletes exactly it
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpError } from "@/shared/lib/http-error";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/features/teams/server/access", () => ({
  requireEffectiveAccess: vi.fn(),
  listEffectiveAccess: vi.fn(),
  resolveLevel: vi.fn(),
}));
vi.mock("./repository");

import { supabaseAdmin } from "@/shared/supabase/admin";
import { requireEffectiveAccess } from "@/features/teams/server/access";
import * as repo from "./repository";
import { purgeWorkflow } from "./service-trash";
import type { WorkflowScope } from "./service-shared";

const scope: WorkflowScope = {
  workspaceId: "ws-1",
  userId: "user-1",
  role: "member",
  source: "user",
};

type LookupResult = { data: unknown; error: unknown };

/** Chainable Supabase-builder stub that records every filter it was given and
 *  resolves the terminal `maybeSingle()` to a configured lookup result. */
function makeDb(result: LookupResult) {
  const calls = {
    from: [] as string[],
    eq: [] as Array<[string, unknown]>,
    not: [] as Array<[string, string, unknown]>,
  };
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    from: (t: string) => {
      calls.from.push(t);
      return builder;
    },
    select: chain,
    eq: (col: string, val: unknown) => {
      calls.eq.push([col, val]);
      return builder;
    },
    not: (col: string, op: string, val: unknown) => {
      calls.not.push([col, op, val]);
      return builder;
    },
    maybeSingle: () => Promise.resolve(result),
  });
  return { builder, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.hardDeleteWorkflow).mockResolvedValue(1);
});

describe("purgeWorkflow", () => {
  it("refuses a LIVE row: the trashed-only lookup finds nothing → 404, no delete", async () => {
    // A live (or absent) workflow resolves to no row because the lookup pins
    // `deleted_at IS NOT NULL`.
    const { builder, calls } = makeDb({ data: null, error: null });
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);

    await expect(purgeWorkflow("live-wf", scope)).rejects.toBeInstanceOf(HttpError);

    // The invariant is enforced at the lookup: trashed-only + workspace-scoped.
    expect(calls.not).toContainEqual(["deleted_at", "is", null]);
    expect(calls.eq).toContainEqual(["workspace_id", "ws-1"]);
    // Never gated, never deleted.
    expect(requireEffectiveAccess).not.toHaveBeenCalled();
    expect(repo.hardDeleteWorkflow).not.toHaveBeenCalled();
  });

  it("surfaces the 404 as WORKFLOW_NOT_FOUND", async () => {
    const { builder } = makeDb({ data: null, error: null });
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);

    await expect(purgeWorkflow("live-wf", scope)).rejects.toMatchObject({
      status: 404,
      code: "WORKFLOW_NOT_FOUND",
    });
  });

  it("hard-deletes a trashed row after the edit gate passes", async () => {
    const { builder } = makeDb({ data: { id: "wf-9" }, error: null });
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
    vi.mocked(requireEffectiveAccess).mockResolvedValue(undefined as never);

    await purgeWorkflow("wf-9", scope);

    // Same edit gate as delete.
    expect(requireEffectiveAccess).toHaveBeenCalledWith(
      "user-1",
      "ws-1",
      "workflow",
      "wf-9",
      "edit",
      { role: "member" }
    );
    // Physical delete of exactly that workflow, workspace-scoped.
    expect(repo.hardDeleteWorkflow).toHaveBeenCalledWith(builder, "ws-1", "wf-9");
  });
});
