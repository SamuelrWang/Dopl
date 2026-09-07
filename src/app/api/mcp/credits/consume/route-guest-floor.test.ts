/**
 * THE GUEST CONSUME PATH, END TO END (2026-08-26 — Samuel: "charge MCP calls
 * from a guest to the user"; closes F-325). ⚠ **THE WALLET MOVED 2026-09-07**
 * (Samuel's per-seat + personal-wallet ruling): the owner's PERSONAL wallet
 * pays, where the owner's sole owned STANDARD workspace used to. Who pays is
 * unchanged; what the credit comes off is not.
 *
 * Drives the REAL exported `POST` through the REAL `withWorkspaceAuth` and the
 * REAL `credits-service`, with only the credential harness and the two
 * repositories mocked. That is deliberate: the bug this file exists for was a
 * DEFAULT (`minRole` unset → `viewer`) plus a ROUTING rule (whose workspace
 * pays), and no assertion about either one separately would have caught it —
 * the route 403'd, `registrar.ts › charge` swallowed the throw, and every guest
 * tool call ran free with one log line to show for it.
 *
 * Four claims, each red under a different single revert:
 *   1. A GUEST-scoped call is ACCEPTED (200, not 403 WORKSPACE_FORBIDDEN).
 *   2. Its credit lands on the CONTAINER OWNER's PERSONAL wallet — never the
 *      guest's own, and never a workspace counter.
 *   3. The owner's own call in their own container is unchanged.
 *   4. A container with no ACTIVE OWNER runs UNMETERED, allowed, stamped
 *      `degraded`, AND LOGGED — the documented fail-open, not silence.
 *      ⚠ **THIS USED TO BE "an owner with no billing workspace"**, which is no
 *      longer a state: a personal wallet needs no workspace, so that branch and
 *      its sibling ambiguity branch are DELETED. The no-active-owner arm is what
 *      is left, and it is the one the database says cannot happen.
 *
 * ⚠ THE FLOOR AND THE ROUTING ARE ONE FIX, NOT TWO. Reverting `minRole:"guest"`
 * fails (1); reverting the owner resolution in `resolveBillingTarget` fails (2)
 * while (1) still passes. Shipping either half alone is a bug with no test.
 *
 * ⚠ A SIBLING OF `route.test.ts` RATHER THAN A SECTION IN IT, AND THE REASON IS
 * STRUCTURAL: that file mocks `withWorkspaceAuth` AWAY to reach the plan/period
 * arithmetic directly, which is exactly the thing a floor test must not do —
 * `vi.mock` is file-scoped, so the two mock strategies cannot share a module.
 * Neither file is redundant: that one owns the entitlement verdict, this one
 * owns who is admitted and whose counter moves.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type {
  Role,
  Workspace,
  WorkspaceMembership,
} from "@/features/workspaces/types";

const state = vi.hoisted(() => ({ userId: "guest-user" }));

// Credential harness: the OAuth-agent-token shape every MCP caller has. The
// write-scope gate is NOT re-enacted here — `writeScopeExempt` is pinned in
// `shared/auth/with-workspace-auth.test.ts`; this file is about the ROLE floor.
vi.mock("@/shared/auth/with-auth", () => ({
  withUserAuth:
    (handler: (req: NextRequest, ctx: unknown) => unknown) =>
    (req: NextRequest) =>
      handler(req, { userId: state.userId, agentTokenId: "tok-1" }),
}));
vi.mock("@/features/workspaces/server/repository", () => ({
  listWorkspacesWithRoleForUser: vi.fn(),
  findWorkspaceById: vi.fn(),
  findMembership: vi.fn(),
  findActiveOwnerUserId: vi.fn(),
}));
vi.mock("@/features/workspaces/server/last-seen", () => ({
  touchLastSeen: vi.fn(),
}));
vi.mock("@/features/workspaces/server/seed-workspace", () => ({
  seedNewWorkspace: vi.fn(),
}));
vi.mock("@/features/analytics/server/mcp-tool-calls", () => ({
  logMcpToolCall: vi.fn(),
}));
vi.mock("@/features/billing/server/workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  // ⚠ THE PAYER'S OWN PERSONAL CONTAINER (2026-09-08). A home burn's LIMIT now
  // comes off the owner's `kind='personal'` row, so this read is on the guest
  // path too — and leaving it unmocked makes the route FAIL OPEN, which looks
  // like a 200 with `allowed: true` and charges nobody.
  getPersonalBilling: vi.fn(),
  countActiveMembers: vi.fn(),
  countOntologyObjects: vi.fn(),
}));
vi.mock("@/features/billing/server/credit-wallets", () => ({
  consumeUserCredits: vi.fn(),
  consumeMemberCredits: vi.fn(),
  getUserCreditsUsed: vi.fn(),
  getMemberCreditsUsed: vi.fn(),
}));
vi.mock("@/features/billing/server/credit-ledger", () => ({
  recordCreditUsageEvent: vi.fn(),
}));

import * as repo from "@/features/workspaces/server/repository";
import * as billing from "@/features/billing/server/workspace-billing";
import * as wallets from "@/features/billing/server/credit-wallets";
import { POST } from "./route";

const mockRepo = vi.mocked(repo);
const mockBilling = vi.mocked(billing);
const mockWallets = vi.mocked(wallets);

const CONTAINER = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const OWNER_WS = "0000ffff-0000-ffff-0000-ffffffffffff";
const OWNER = "operator-user";
const GUEST = "guest-user";
/** The OWNER's own `kind='personal'` container — where their home plan lives. */
const OWNER_PERSONAL = "0000aaaa-0000-aaaa-0000-aaaaaaaaaaaa";

function workspace(id: string, kind: "standard" | "link"): Workspace {
  return {
    id,
    ownerId: OWNER,
    name: `ws ${id}`,
    slug: `ws-${id.slice(0, 4)}`,
    publicId: `pub-${id.slice(0, 4)}`,
    description: null,
    iconUrl: null,
    kind,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function membership(workspaceId: string, role: Role): WorkspaceMembership {
  return {
    workspaceId,
    userId: state.userId,
    role,
    status: "active",
    joinedAt: "2026-01-01T00:00:00Z",
    invitedBy: null,
    invitedAt: null,
    lastSeenAt: null,
  };
}

/** POST the consume route addressed at `workspaceId`, as `role`. */
async function consumeAs(
  role: Role,
  workspaceId = CONTAINER,
  kind: "standard" | "link" = "link"
) {
  mockRepo.findWorkspaceById.mockResolvedValue(workspace(workspaceId, kind));
  mockRepo.findMembership.mockResolvedValue(membership(workspaceId, role));
  const res = await POST(
    new NextRequest("http://localhost/api/mcp/credits/consume", {
      method: "POST",
      headers: { "x-workspace-id": workspaceId },
    }),
    { params: Promise.resolve({}) }
  );
  return { res, body: await res.json() };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  state.userId = GUEST;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  mockRepo.findActiveOwnerUserId.mockResolvedValue(OWNER);
  mockBilling.getWorkspaceBilling.mockResolvedValue(null);
  // The OWNER's home space, free — a container that exists and has no sub.
  mockBilling.getPersonalBilling.mockResolvedValue({
    containerId: OWNER_PERSONAL,
    billing: null,
  });
  mockBilling.countActiveMembers.mockResolvedValue(1);
  mockBilling.countOntologyObjects.mockResolvedValue(0);
  mockWallets.consumeUserCredits.mockResolvedValue({ allowed: true, used: 3 });
  mockWallets.consumeMemberCredits.mockResolvedValue({ allowed: true, used: 3 });
});

afterEach(() => {
  warn.mockRestore();
});

describe("POST /api/mcp/credits/consume — a guest is metered, not refused", () => {
  it("1. accepts a GUEST-scoped call (the viewer default used to 403 it)", async () => {
    const { res, body } = await consumeAs("guest");
    expect(res.status).toBe(200);
    // ⚠ Not just "not 403": a 403 body would still be JSON. Name the code that
    // WAS returned, so a future refusal cannot pass as a shape change.
    expect(body.error).toBeUndefined();
    expect(body.allowed).toBe(true);
  });

  it("2. charges the CONTAINER OWNER's PERSONAL wallet — not the guest's, not a workspace", async () => {
    const { body } = await consumeAs("guest");

    expect(mockRepo.findActiveOwnerUserId).toHaveBeenCalledWith(CONTAINER);
    // ⚠ THE LOAD-BEARING ASSERTION. The pre-fix code billed the CALLER;
    // asserting only "the RPC ran" stayed green through that.
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledWith(
      OWNER,
      expect.any(String),
      1,
      expect.any(Number)
    );
    expect(mockWallets.consumeUserCredits).not.toHaveBeenCalledWith(
      GUEST,
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    // ⚠ AND NO WORKSPACE COUNTER MOVES AT ALL on a container. A seat RPC here
    // would be the pooled model coming back through the wrong door.
    expect(mockWallets.consumeMemberCredits).not.toHaveBeenCalled();
    expect(body.wallet).toBe("personal");
  });

  it("2c. the LIMIT comes off the OWNER's personal row, never the guest's", async () => {
    // ⚠ **THE 2026-09-08 HALF OF THE SAME RULING.** Who pays was settled
    // 2026-08-26; what they are entitled to is new, and a version that resolved
    // the tier from the CALLER would charge the owner's counter against the
    // guest's plan — the owner's Pro allowance silently capped at the guest's
    // free 500.
    mockBilling.getPersonalBilling.mockResolvedValue({
      containerId: OWNER_PERSONAL,
      billing: {
        workspaceId: OWNER_PERSONAL,
        plan: "pro",
        status: "active",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        stripePriceId: "price_personal_pro",
        seatCount: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        lastStripeEventCreated: null,
      },
    });

    const { body } = await consumeAs("guest");

    expect(mockBilling.getPersonalBilling).toHaveBeenCalledWith(OWNER);
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledWith(
      OWNER,
      expect.any(String),
      1,
      5_000
    );
    expect(body.limit).toBe(5_000);
  });

  it("2b. a guest with a home space of their own still does not spend it", async () => {
    // The guest is not wallet-less — every user has a personal wallet — which is
    // exactly the case a "does it fall back to the caller" bug reads as fine.
    await consumeAs("guest");
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledTimes(1);
    expect(mockWallets.consumeUserCredits.mock.calls[0]?.[0]).toBe(OWNER);
  });

  it("3. the OWNER's own call in their own container is unchanged", async () => {
    state.userId = OWNER;
    const { res } = await consumeAs("owner");
    expect(res.status).toBe(200);
    expect(mockWallets.consumeUserCredits).toHaveBeenCalledWith(
      OWNER,
      expect.any(String),
      1,
      expect.any(Number)
    );
  });

  it("3b. a STANDARD workspace charges the CALLER'S SEAT, asking nobody who owns it", async () => {
    const { res, body } = await consumeAs("member", OWNER_WS, "standard");
    expect(res.status).toBe(200);
    expect(mockRepo.findActiveOwnerUserId).not.toHaveBeenCalled();
    expect(mockWallets.consumeMemberCredits).toHaveBeenCalledWith(
      OWNER_WS,
      GUEST,
      expect.any(String),
      1,
      expect.any(Number)
    );
    expect(mockWallets.consumeUserCredits).not.toHaveBeenCalled();
    expect(body.wallet).toBe("seat");
  });
});

describe("the container has no active owner — fail OPEN, and say so", () => {
  it("4. allowed + stamped degraded, nothing charged anywhere", async () => {
    // Unreachable while `20260720184806_workspace_last_active_owner_guard.sql`
    // holds (a workspace cannot lose its last active owner) — asserted so the
    // branch answers unmetered-and-logged rather than throwing if it ever is.
    mockRepo.findActiveOwnerUserId.mockResolvedValue(null);
    const { res, body } = await consumeAs("guest");

    expect(res.status).toBe(200);
    expect(body.allowed).toBe(true);
    expect(body).toMatchObject({
      used: 0,
      limit: 0,
      remaining: 0,
      degraded: true,
      wallet: null,
    });
    expect(mockWallets.consumeUserCredits).not.toHaveBeenCalled();
    expect(mockWallets.consumeMemberCredits).not.toHaveBeenCalled();
    expect(mockBilling.getWorkspaceBilling).not.toHaveBeenCalled();
  });

  it("4b. LOGS the reason — silence here is indistinguishable from the bug", async () => {
    mockRepo.findActiveOwnerUserId.mockResolvedValue(null);
    await consumeAs("guest");

    // Assert the CONTENT, not that something was logged: the reason and the
    // caller are what make the line actionable when a guardrail is written.
    const line = warn.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(line).toContain("container-has-no-active-owner");
    expect(line).toContain(CONTAINER);
    expect(line).toContain(GUEST);
  });
});

describe("the floor is the only thing that changed — everything else still refuses", () => {
  it("a NON-MEMBER is still 404, not billed", async () => {
    mockRepo.findWorkspaceById.mockResolvedValue(workspace(CONTAINER, "link"));
    mockRepo.findMembership.mockResolvedValue(null);
    const res = await POST(
      new NextRequest("http://localhost/api/mcp/credits/consume", {
        method: "POST",
        headers: { "x-workspace-id": CONTAINER },
      }),
      { params: Promise.resolve({}) }
    );
    expect(res.status).toBe(404);
    expect(mockWallets.consumeUserCredits).not.toHaveBeenCalled();
    expect(mockWallets.consumeMemberCredits).not.toHaveBeenCalled();
  });

  it("a non-UUID workspace header is still 400 WORKSPACE_INVALID", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/mcp/credits/consume", {
        method: "POST",
        headers: { "x-workspace-id": "my-slug" },
      }),
      { params: Promise.resolve({}) }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("WORKSPACE_INVALID");
  });
});
