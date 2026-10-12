/**
 * 🔒 AN IDENTITY'S OWN GRANT ARM HONOURS THE CREDENTIAL LOCK (Batch 11 policy call; #3610 class).
 *
 * `shareCtxForIdentities` — the grant arm behind `listIdentities`, `loadVisibleIdentityRow` and the
 * ref resolver — asked `grantedResourceIds` with NO lock, so a token locked to A saw an identity that
 * lives in A but whose only grant is to a scope in B, outside the lock. (The identity's attached BASES
 * were fixed first; this is the identity row itself.) Driven through the REAL matrix and the REAL grant
 * reach: only Supabase and the repository are faked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("./repository", () => ({
  findIdentityById: vi.fn(),
  listTeamIdsForUser: vi.fn(async () => []),
  listTeamLinksForIdentities: vi.fn(async () => []),
}));

import * as repo from "./repository";
import { loadVisibleIdentityRow } from "./service-reads";
import type { AgentIdentity, AgentIdentityContext } from "../types";
import {
  makeAdmin,
  member,
  ME,
  WS_A,
  WS_B,
  T1,
} from "@/shared/tenancy/resolve-resource-fixture";

/** Another member's private identity, sitting IN the locked container. */
const identityT1 = {
  id: T1,
  name: "Code Auditor",
  workspaceId: WS_A,
  visibility: "private",
  createdBy: "someone-else",
  teamIds: [],
} as unknown as AgentIdentity;

const ctxFor = (apiKeyWorkspaceId: string | null): AgentIdentityContext =>
  ({
    workspaceId: WS_A,
    userId: ME,
    source: "agent",
    role: "member",
    apiKeyWorkspaceId,
    credentialSubjectUserId: ME,
  }) as unknown as AgentIdentityContext;

/** T1 is lent to CONTAINER `scope`; the caller is a member of A and of B. No home space. */
function lentTo(scope: string) {
  makeAdmin({
    resource_grants: [
      {
        scope_type: "container",
        scope_id: scope,
        resource_id: T1,
        level: "read",
      },
    ],
    workspace_members: [member(WS_A), member(WS_B)],
    workspaces: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findIdentityById).mockResolvedValue(identityT1 as never);
});

describe("🔒 an agent identity, through a locked credential", () => {
  it("LOCKED to A: an identity lent only to a scope in B is invisible", async () => {
    lentTo(WS_B);
    expect(await loadVisibleIdentityRow(ctxFor(WS_A), T1)).toBeNull();
  });

  it("LOCKED to A: an identity lent to a scope in A stays visible", async () => {
    lentTo(WS_A);
    expect((await loadVisibleIdentityRow(ctxFor(WS_A), T1))?.id).toBe(T1);
  });

  it("UNLOCKED: the identity lent to B stays visible (unchanged)", async () => {
    lentTo(WS_B);
    expect((await loadVisibleIdentityRow(ctxFor(null), T1))?.id).toBe(T1);
  });
});
