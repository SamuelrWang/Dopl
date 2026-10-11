/**
 * 🔒 A BASE'S GRANT ARM HONOURS THE CREDENTIAL LOCK (Batch 11 policy call; same class as #3610).
 *
 * `baseGrantsFor` — the grant arm behind `assertBaseVisible`, `listBases` and the entry reads — asked
 * `grantedResourceIds` with NO lock, so a token locked to A read a base that lives in A but whose only
 * grant is to a scope in B, outside the lock. Driven through the REAL gate and the REAL grant reach
 * (only Supabase is faked), so a fix that filters somewhere else still has to pass this.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { assertBaseVisible } from "./service-shared";
import type { KnowledgeBase, KnowledgeContext } from "../types";
import {
  makeAdmin,
  member,
  ME,
  WS_A,
  WS_B,
} from "@/shared/tenancy/resolve-resource-fixture";

const K = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/** Another member's private base, sitting IN the locked container. */
const baseK = {
  id: K,
  name: "Payroll",
  slug: "payroll",
  visibility: "private",
  accessMode: "workspace",
  createdBy: "someone-else",
} as unknown as KnowledgeBase;

const ctxFor = (apiKeyWorkspaceId: string | null): KnowledgeContext =>
  ({
    workspaceId: WS_A,
    userId: ME,
    role: "member",
    source: "agent",
    apiKeyWorkspaceId,
    credentialSubjectUserId: ME,
    sessionId: null,
  }) as unknown as KnowledgeContext;

/** K is lent to CONTAINER `scope`; the caller is a member of A and of B. No home space. */
function lentTo(scope: string) {
  makeAdmin({
    resource_grants: [
      {
        scope_type: "container",
        scope_id: scope,
        resource_id: K,
        level: "read",
      },
    ],
    workspace_members: [member(WS_A), member(WS_B)],
    workspaces: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("🔒 a knowledge base's grant arm, through a locked credential", () => {
  it("LOCKED to A: a base lent only to a scope in B is 404", async () => {
    lentTo(WS_B);
    await expect(assertBaseVisible(ctxFor(WS_A), baseK)).rejects.toThrow();
  });

  it("LOCKED to A: a base lent to a scope in A stays readable", async () => {
    lentTo(WS_A);
    await expect(
      assertBaseVisible(ctxFor(WS_A), baseK)
    ).resolves.toBeUndefined();
  });

  it("UNLOCKED: the base lent to B stays readable (unchanged)", async () => {
    lentTo(WS_B);
    await expect(
      assertBaseVisible(ctxFor(null), baseK)
    ).resolves.toBeUndefined();
  });
});
