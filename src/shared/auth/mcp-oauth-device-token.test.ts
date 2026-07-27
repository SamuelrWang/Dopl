/**
 * Unit tests for `issueDeviceToken` — the revoke-and-replace invariant.
 * `supabaseAdmin` is mocked with a chainable builder that records every call.
 *
 * Contract: one active device token per (user, client, label). A fresh mint
 * MUST first revoke any prior un-revoked token for that exact triple (so a
 * looping client can't accumulate unbounded 90-day credentials), and the
 * revoke UPDATE must run BEFORE the new INSERT.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { issueDeviceToken, MCP_SCOPES } from "./mcp-oauth";

// The reserved first-party client every CLI device token is issued under
// (private const in mcp-oauth.ts — pinned here as the contract value).
const DEVICE_CLIENT_ID = "dopl_client_device_cli";

type Call = { op: string; args: unknown[] };

/**
 * Chainable, thenable Supabase-builder stub. Every method records its call and
 * returns the builder; awaiting the builder at any point resolves to a
 * success result, so `.upsert(...)`, `.update(...).eq()...is()`, and
 * `.insert(...)` all resolve without a real DB.
 */
function makeAdmin() {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  const rec = (op: string, args: unknown[]) => {
    calls.push({ op, args });
    return builder;
  };
  Object.assign(builder, {
    from: (t: string) => rec("from", [t]),
    upsert: (v: unknown, o: unknown) => rec("upsert", [v, o]),
    update: (v: unknown) => rec("update", [v]),
    insert: (v: unknown) => rec("insert", [v]),
    eq: (c: string, v: unknown) => rec("eq", [c, v]),
    is: (c: string, v: unknown) => rec("is", [c, v]),
    then: (resolve: (r: { data: null; error: null }) => void) =>
      resolve({ data: null, error: null }),
  });
  return { builder, calls };
}

function opIndex(calls: Call[], op: string): number {
  return calls.findIndex((c) => c.op === op);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("issueDeviceToken", () => {
  it("revokes prior tokens for (user, device client, label) BEFORE inserting the new one", async () => {
    const { builder, calls } = makeAdmin();
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);

    await issueDeviceToken({ userId: "user-9", deviceLabel: "Sams-MBP" });

    const updateIdx = opIndex(calls, "update");
    const insertIdx = opIndex(calls, "insert");
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    // The revoke must precede the insert.
    expect(updateIdx).toBeLessThan(insertIdx);

    // The revoke UPDATE stamps revoked_at.
    const updateArg = calls[updateIdx].args[0] as Record<string, unknown>;
    expect(typeof updateArg.revoked_at).toBe("string");

    // The revoke chain's filters: exactly (user, device client, label) and
    // only rows not already revoked.
    const revokeFilters = calls
      .slice(updateIdx, insertIdx)
      .filter((c) => c.op === "eq" || c.op === "is")
      .map((c) => [c.op, ...c.args]);
    expect(revokeFilters).toContainEqual(["eq", "user_id", "user-9"]);
    expect(revokeFilters).toContainEqual(["eq", "client_id", DEVICE_CLIENT_ID]);
    expect(revokeFilters).toContainEqual(["eq", "client_name", "Sams-MBP"]);
    expect(revokeFilters).toContainEqual(["is", "revoked_at", null]);
  });

  it("inserts a hashed, non-refreshable device token with default MCP scopes", async () => {
    const { builder, calls } = makeAdmin();
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);

    const { token, expiresAt } = await issueDeviceToken({
      userId: "user-9",
      deviceLabel: "Sams-MBP",
    });

    const insertArg = calls[opIndex(calls, "insert")].args[0] as Record<string, unknown>;
    expect(insertArg.user_id).toBe("user-9");
    expect(insertArg.client_id).toBe(DEVICE_CLIENT_ID);
    expect(insertArg.client_name).toBe("Sams-MBP");
    // No refresh token — a device re-mints rather than rotating.
    expect(insertArg.refresh_token_hash).toBeNull();
    expect(insertArg.refresh_expires_at).toBeNull();
    // Only the hash is persisted, never the plaintext token.
    expect(typeof insertArg.access_token_hash).toBe("string");
    expect(insertArg.access_token_hash).not.toBe(token);
    // Default scopes = the full read+write MCP set.
    expect(insertArg.scopes).toEqual([...MCP_SCOPES]);

    // The returned token is a plaintext access token; expiry ~90 days out.
    expect(token.startsWith("dopl_at_")).toBe(true);
    const ttlDays = (Date.parse(expiresAt) - Date.now()) / 86_400_000;
    expect(ttlDays).toBeGreaterThan(89);
    expect(ttlDays).toBeLessThan(91);
    expect(insertArg.access_expires_at).toBe(expiresAt);
  });

  it("honors caller-supplied scopes over the default", async () => {
    const { builder, calls } = makeAdmin();
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);

    await issueDeviceToken({
      userId: "user-9",
      deviceLabel: "ci-box",
      scopes: ["dopl.read"],
    });

    const insertArg = calls[opIndex(calls, "insert")].args[0] as Record<string, unknown>;
    expect(insertArg.scopes).toEqual(["dopl.read"]);
  });

  it("ensures the reserved device client row exists before minting", async () => {
    const { builder, calls } = makeAdmin();
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);

    await issueDeviceToken({ userId: "user-9", deviceLabel: "Sams-MBP" });

    // ensureDeviceClient upserts the oauth_clients row, and it happens first.
    const upsertIdx = opIndex(calls, "upsert");
    expect(upsertIdx).toBeGreaterThanOrEqual(0);
    expect(upsertIdx).toBeLessThan(opIndex(calls, "insert"));
    const upsertTarget = calls[opIndex(calls, "from")].args[0];
    expect(upsertTarget).toBe("oauth_clients");
  });
});
