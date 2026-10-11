/**
 * 🔒 THE IDENTITY'S BASES HONOUR THE CREDENTIAL LOCK (Batch 11; same class as #3610).
 *
 * `resolveVisibleKnowledgeBases` is reached by `read-resource.ts › readResourceById` following an
 * identity. Its grant arm asked `grantedResourceIds` with NO lock, so a token locked to A read, through
 * an identity lent into A, the name and description of base K whose only grant is to a scope in B.
 * Driven through the REAL grant reach and the REAL lock (only Supabase and the repository are faked).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("./repository", () => ({
  listKnowledgeBaseAccessRows: vi.fn(),
  listKnowledgeBaseTeamGrants: vi.fn(async () => []),
  listTeamIdsForUser: vi.fn(async () => []),
}));

import * as repo from "./repository";
import { resolveVisibleKnowledgeBases } from "./service-shared";
import { makeAdmin, member, ME, WS_A, WS_B } from "@/shared/tenancy/resolve-resource-fixture";

const K = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const baseK = {
  id: K,
  name: "Payroll",
  slug: "payroll",
  description: "salaries",
  visibility: "private" as const,
  accessMode: "workspace" as const,
  createdBy: "someone-else",
};
const ctxFor = (apiKeyWorkspaceId: string | null) => ({
  workspaceId: WS_A,
  userId: ME,
  source: "agent" as const,
  role: "member" as const,
  apiKeyWorkspaceId,
  credentialSubjectUserId: ME,
});

/** K is lent to CONTAINER `scope`; the caller is a member of A and of B. No home space. */
function lentTo(scope: string) {
  makeAdmin({
    resource_grants: [{ scope_type: "container", scope_id: scope, resource_id: K, level: "read" }],
    workspace_members: [member(WS_A), member(WS_B)],
    workspaces: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.listKnowledgeBaseAccessRows).mockResolvedValue([baseK] as never);
});

describe("🔒 an identity's bases, through a locked credential", () => {
  it("LOCKED to A: a base lent only to a scope in B is hidden", async () => {
    lentTo(WS_B);
    expect(await resolveVisibleKnowledgeBases(ctxFor(WS_A), [K])).toEqual([]);
  });

  it("LOCKED to A: a base lent to a scope in A is visible", async () => {
    lentTo(WS_A);
    expect((await resolveVisibleKnowledgeBases(ctxFor(WS_A), [K])).map((b) => b.id)).toEqual([K]);
  });

  it("UNLOCKED: the base lent to B stays visible (unchanged)", async () => {
    lentTo(WS_B);
    expect((await resolveVisibleKnowledgeBases(ctxFor(null), [K])).map((b) => b.id)).toEqual([K]);
  });
});
