/**
 * Per-KB storage gate. Pins four properties: freezes but never deletes (shrink
 * on an over-cap base must succeed); fails OPEN; plan = entitlement verdict,
 * never `workspace_billing.plan`; refusal uses the FLAT plan-gate envelope
 * at 403.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeBase, KnowledgeContext } from "../types";

vi.mock("./repository", () => ({ getBaseStorageBytes: vi.fn() }));
vi.mock("@/features/billing/server/workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  countActiveMembers: vi.fn(),
}));

import * as repo from "./repository";
import {
  countActiveMembers,
  getWorkspaceBilling,
} from "@/features/billing/server/workspace-billing";
import { KnowledgeStorageLimitError } from "./errors";
import {
  assertStorageHeadroom,
  bodyBytes,
  kbStorageDeniedBody,
  resolveKbStorageLimit,
} from "./service-storage";

const mockRepo = vi.mocked(repo);
const mockBilling = vi.mocked(getWorkspaceBilling);
const mockMembers = vi.mocked(countActiveMembers);

const CTX = { workspaceId: "ws-1", userId: "u-1" } as KnowledgeContext;
const BASE = { id: "kb-1", name: "Product specs" } as KnowledgeBase;

const FREE = 5_000_000;
const PAID = 100_000_000;

/** No billing row = ordinary free workspace. */
function freeWorkspace() {
  mockBilling.mockResolvedValue(null);
  mockMembers.mockResolvedValue(1);
}

beforeEach(() => {
  vi.clearAllMocks();
  freeWorkspace();
});

describe("bodyBytes", () => {
  it("measures UTF-8 BYTES, the unit octet_length() counts", () => {
    // ⚠ Counter is SQL `octet_length(body)`. UTF-16 code units would gate an
    // emoji body at half its real weight and drift silently.
    expect(bodyBytes("abc")).toBe(3);
    expect(bodyBytes("é")).toBe(2);
    expect(bodyBytes("🙂")).toBe(4);
    expect(bodyBytes("")).toBe(0);
    expect(bodyBytes(undefined)).toBe(0);
  });
});

describe("resolveKbStorageLimit — the entitlement verdict", () => {
  it("gives a free workspace the free cap", async () => {
    expect(await resolveKbStorageLimit("ws-1")).toBe(FREE);
  });

  it("gives a live solo the paid cap", async () => {
    mockBilling.mockResolvedValue({ plan: "solo", status: "active" } as never);
    mockMembers.mockResolvedValue(1);
    expect(await resolveKbStorageLimit("ws-1")).toBe(PAID);
  });

  it("DEGRADES a solo that has grown a second member back to the free cap", async () => {
    // Abuse path: cheap solo plan + a teammate, keeping the paid ceiling.
    // `entitledPlanFor` (not `workspace_billing.plan`) closes it.
    mockBilling.mockResolvedValue({ plan: "solo", status: "active" } as never);
    mockMembers.mockResolvedValue(2);
    expect(await resolveKbStorageLimit("ws-1")).toBe(FREE);
  });

  it("reverts a CANCELED subscription to the free cap", async () => {
    mockBilling.mockResolvedValue({ plan: "team", status: "canceled" } as never);
    mockMembers.mockResolvedValue(4);
    expect(await resolveKbStorageLimit("ws-1")).toBe(FREE);
  });

  it("keeps a PAST_DUE workspace on its paid cap (paid-with-warning)", async () => {
    mockBilling.mockResolvedValue({ plan: "team", status: "past_due" } as never);
    mockMembers.mockResolvedValue(4);
    expect(await resolveKbStorageLimit("ws-1")).toBe(PAID);
  });

  it("answers UNKNOWN, not a cap, when billing cannot be read", async () => {
    mockBilling.mockRejectedValue(new Error("billing down"));
    expect(await resolveKbStorageLimit("ws-1")).toBeNull();
  });
});

describe("assertStorageHeadroom — growth", () => {
  it("allows a write that fits", async () => {
    mockRepo.getBaseStorageBytes.mockResolvedValue(1_000_000);
    await expect(assertStorageHeadroom(CTX, BASE, 500_000)).resolves.toBeUndefined();
  });

  it("allows a write that lands EXACTLY on the cap", async () => {
    mockRepo.getBaseStorageBytes.mockResolvedValue(FREE - 100);
    await expect(assertStorageHeadroom(CTX, BASE, 100)).resolves.toBeUndefined();
  });

  it("refuses the byte that would cross the cap", async () => {
    mockRepo.getBaseStorageBytes.mockResolvedValue(FREE - 100);
    await expect(assertStorageHeadroom(CTX, BASE, 101)).rejects.toBeInstanceOf(
      KnowledgeStorageLimitError
    );
  });

  it("lets the same write through on a paid plan", async () => {
    mockBilling.mockResolvedValue({ plan: "team", status: "active" } as never);
    mockMembers.mockResolvedValue(3);
    mockRepo.getBaseStorageBytes.mockResolvedValue(FREE - 100);
    await expect(assertStorageHeadroom(CTX, BASE, 101)).resolves.toBeUndefined();
  });
});

describe("assertStorageHeadroom — freeze, don't delete", () => {
  it("allows a SHRINKING edit while the base is already over cap", async () => {
    // Over cap, a smaller body is the only way out — refusing locks the base
    // permanently.
    mockRepo.getBaseStorageBytes.mockResolvedValue(FREE + 2_000_000);
    await expect(assertStorageHeadroom(CTX, BASE, -1)).resolves.toBeUndefined();
    await expect(
      assertStorageHeadroom(CTX, BASE, -1_500_000)
    ).resolves.toBeUndefined();
  });

  it("costs nothing — not even a read — for a zero delta", async () => {
    // Renames/moves/repositions must cost no query.
    await expect(assertStorageHeadroom(CTX, BASE, 0)).resolves.toBeUndefined();
    expect(mockRepo.getBaseStorageBytes).not.toHaveBeenCalled();
    expect(mockBilling).not.toHaveBeenCalled();
  });
});

describe("assertStorageHeadroom — fail OPEN", () => {
  it("allows the write when the counter column does not exist yet", async () => {
    // DEPLOY ORDER: server ahead of migration. Refusing would 403 every
    // knowledge write with a billing message.
    mockRepo.getBaseStorageBytes.mockRejectedValue(
      new Error('column "storage_bytes" does not exist')
    );
    await expect(
      assertStorageHeadroom(CTX, BASE, 9_000_000)
    ).resolves.toBeUndefined();
  });

  it("allows the write when the base row is missing", async () => {
    mockRepo.getBaseStorageBytes.mockResolvedValue(null);
    await expect(
      assertStorageHeadroom(CTX, BASE, 9_000_000)
    ).resolves.toBeUndefined();
  });

  it("allows the write when the plan cannot be resolved", async () => {
    mockRepo.getBaseStorageBytes.mockResolvedValue(FREE);
    mockBilling.mockRejectedValue(new Error("billing down"));
    await expect(
      assertStorageHeadroom(CTX, BASE, 9_000_000)
    ).resolves.toBeUndefined();
  });
});

describe("the refusal envelope", () => {
  it("is the FLAT plan-gate shape, with the numbers on the error", async () => {
    mockRepo.getBaseStorageBytes.mockResolvedValue(FREE);
    const err = await assertStorageHeadroom(CTX, BASE, 1).catch((e) => e);

    expect(err).toBeInstanceOf(KnowledgeStorageLimitError);
    expect(err.code).toBe("kb_storage_full");
    expect(err.usedBytes).toBe(FREE);
    expect(err.limitBytes).toBe(FREE);
    expect(err.deltaBytes).toBe(1);

    const body = kbStorageDeniedBody(err);
    // Flat `{error, message, upgrade_url}` with a STRING code, NOT the nested
    // `{error: {code, message}}`. `@dopl/client` and
    // `mcp-server/tools/respond.ts` parse this one.
    expect(Object.keys(body).sort()).toEqual([
      "error",
      "message",
      "upgrade_url",
    ]);
    expect(body.error).toBe("kb_storage_full");
    expect(typeof body.upgrade_url).toBe("string");
    // Base name, both numbers, and that nothing was destroyed.
    expect(body.message).toContain("Product specs");
    expect(body.message).toContain("5 MB");
    expect(body.message).toContain("Nothing has been deleted");
  });
});
