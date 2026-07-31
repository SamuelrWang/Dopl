/**
 * Unit tests for the device-token lifecycle — `issueDeviceToken`'s
 * revoke-and-replace invariant and `revokeDeviceTokens` (F-085), plus the
 * property that makes revocation mean anything: `validateAccessToken` refuses a
 * revoked row. `supabaseAdmin` is mocked with a chainable builder that records
 * every call.
 *
 * Contract: one active device token per (user, client, label). A fresh mint
 * MUST first revoke any prior un-revoked token for that exact triple (so a
 * looping client can't accumulate unbounded 90-day credentials), and the
 * revoke UPDATE must run BEFORE the new INSERT.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  issueDeviceToken,
  revokeDeviceTokens,
  validateAccessToken,
  MCP_SCOPES,
} from "./mcp-oauth";

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

// ── F-085: revokeDeviceTokens ──────────────────────────────────────────────
//
// The server half of desktop sign-out. Until this existed, sign-out could only
// delete the app's local copies while the 90-day dopl.read+dopl.write bearer
// stayed valid — so anything that had already read it kept full API access to
// the account that just signed out.

/**
 * Like `makeAdmin`, but each awaited chain resolves to the next queued row set
 * (what `.select("id")` returns after an UPDATE). Also records `.select`.
 */
function makeRevokeAdmin(results: { id: string }[][]) {
  const calls: Call[] = [];
  const queue = [...results];
  const builder: Record<string, unknown> = {};
  const rec = (op: string, args: unknown[]) => {
    calls.push({ op, args });
    return builder;
  };
  Object.assign(builder, {
    from: (t: string) => rec("from", [t]),
    update: (v: unknown) => rec("update", [v]),
    eq: (c: string, v: unknown) => rec("eq", [c, v]),
    is: (c: string, v: unknown) => rec("is", [c, v]),
    select: (c: string) => rec("select", [c]),
    then: (resolve: (r: { data: unknown; error: null }) => void) =>
      resolve({ data: queue.shift() ?? [], error: null }),
  });
  return { builder, calls };
}

/** Every filter applied on the chain, as comparable tuples. */
function filters(calls: Call[]): unknown[][] {
  return calls
    .filter((c) => c.op === "eq" || c.op === "is")
    .map((c) => [c.op, ...c.args]);
}

describe("revokeDeviceTokens (F-085)", () => {
  it("revokes by label, scoped to the owner AND the reserved device client", async () => {
    const { builder, calls } = makeRevokeAdmin([[{ id: "tok-1" }]]);
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);

    const revoked = await revokeDeviceTokens({
      userId: "user-9",
      label: "Dopl Desktop CLI (Sams-MBP)",
    });

    expect(revoked).toBe(1);
    expect(calls[opIndex(calls, "from")].args[0]).toBe("mcp_tokens");
    // Soft revoke: revoked_at is stamped, the row is NOT deleted (the settings
    // list and the audit trail both read it).
    const updateArg = calls[opIndex(calls, "update")].args[0] as Record<string, unknown>;
    expect(Object.keys(updateArg)).toEqual(["revoked_at"]);
    expect(typeof updateArg.revoked_at).toBe("string");

    const f = filters(calls);
    // OWNER SCOPE — without this, one user could revoke another's credential.
    expect(f).toContainEqual(["eq", "user_id", "user-9"]);
    // DEVICE-CLIENT SCOPE — this surface mints device tokens, so it revokes
    // device tokens; an OAuth agent grant is revoked from Connected apps.
    expect(f).toContainEqual(["eq", "client_id", DEVICE_CLIENT_ID]);
    expect(f).toContainEqual(["eq", "client_name", "Dopl Desktop CLI (Sams-MBP)"]);
    // Already-revoked rows keep their ORIGINAL timestamp.
    expect(f).toContainEqual(["is", "revoked_at", null]);
  });

  it("revokes by token id, still scoped to the owner and the device client", async () => {
    const { builder, calls } = makeRevokeAdmin([[{ id: "tok-7" }]]);
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);

    const revoked = await revokeDeviceTokens({ userId: "user-9", tokenId: "tok-7" });

    expect(revoked).toBe(1);
    const f = filters(calls);
    expect(f).toContainEqual(["eq", "id", "tok-7"]);
    expect(f).toContainEqual(["eq", "user_id", "user-9"]);
    expect(f).toContainEqual(["eq", "client_id", DEVICE_CLIENT_ID]);
    expect(f).toContainEqual(["is", "revoked_at", null]);
  });

  it("IDEMPOTENT: an unknown or already-revoked token is a quiet 0, not a failure", async () => {
    const { builder } = makeRevokeAdmin([[]]);
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
    await expect(
      revokeDeviceTokens({ userId: "user-9", label: "nothing-here" })
    ).resolves.toBe(0);
  });

  it("counts rows once when label and id select the SAME token", async () => {
    const { builder } = makeRevokeAdmin([[{ id: "tok-1" }], [{ id: "tok-1" }]]);
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
    await expect(
      revokeDeviceTokens({ userId: "user-9", label: "L", tokenId: "tok-1" })
    ).resolves.toBe(1);
  });

  it("touches nothing when neither selector is supplied", async () => {
    const { builder, calls } = makeRevokeAdmin([]);
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
    await expect(revokeDeviceTokens({ userId: "user-9" })).resolves.toBe(0);
    expect(calls).toEqual([]); // no UPDATE was ever issued
  });

  it("propagates a DB error instead of reporting a revoke that never happened", async () => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    Object.assign(builder, {
      from: chain, update: chain, eq: chain, is: chain, select: chain,
      then: (resolve: (r: { data: null; error: { message: string } }) => void) =>
        resolve({ data: null, error: { message: "boom" } }),
    });
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
    await expect(revokeDeviceTokens({ userId: "u", label: "L" })).rejects.toBeTruthy();
  });
});

// ── What makes revocation MEAN something ───────────────────────────────────

describe("validateAccessToken vs a revoked row", () => {
  /** Single-row read builder: `.select(...).eq(...).maybeSingle()`. */
  function makeReader(row: Record<string, unknown> | null) {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    Object.assign(builder, {
      from: chain,
      select: chain,
      eq: chain,
      update: chain,
      maybeSingle: async () => ({ data: row, error: null }),
      then: (resolve: (r: { data: null; error: null }) => void) =>
        resolve({ data: null, error: null }),
    });
    return builder;
  }

  const future = new Date(Date.now() + 86_400_000).toISOString();

  it("a revoked device token is refused even though it has not expired", async () => {
    vi.mocked(supabaseAdmin).mockReturnValue(
      makeReader({
        id: "tok-1",
        user_id: "user-9",
        scopes: ["dopl.read", "dopl.write"],
        access_expires_at: future, // 90-day TTL still has ~89 days left
        revoked_at: new Date().toISOString(),
      }) as never
    );
    expect(await validateAccessToken("dopl_at_deadbeef")).toBeNull();
  });

  it("…and the same row un-revoked still validates (the test is not vacuous)", async () => {
    vi.mocked(supabaseAdmin).mockReturnValue(
      makeReader({
        id: "tok-1",
        user_id: "user-9",
        scopes: ["dopl.read", "dopl.write"],
        access_expires_at: future,
        revoked_at: null,
      }) as never
    );
    expect(await validateAccessToken("dopl_at_deadbeef")).toEqual({
      userId: "user-9",
      scopes: ["dopl.read", "dopl.write"],
      tokenId: "tok-1",
      credential: { kind: "oauth-app", label: null },
    });
  });

  /**
   * WHAT THE VALIDATOR NOW CARRIES OUT. These two columns were in the row all
   * along and the select skipped them, which is why the transport boundary
   * could not tell the agent what credential it was acting through. Both are
   * descriptive: nothing in the codebase gates on either.
   */
  it("reports a device token as `device`, carrying its mint label verbatim", async () => {
    vi.mocked(supabaseAdmin).mockReturnValue(
      makeReader({
        id: "tok-1",
        user_id: "user-9",
        scopes: ["dopl.read", "dopl.write"],
        access_expires_at: future,
        revoked_at: null,
        client_id: DEVICE_CLIENT_ID,
        client_name: "Dopl Desktop CLI (mbp.local)",
      }) as never
    );
    expect(await validateAccessToken("dopl_at_deadbeef")).toMatchObject({
      credential: { kind: "device", label: "Dopl Desktop CLI (mbp.local)" },
    });
  });

  /**
   * The DISCRIMINATOR IS `client_id`, NOT THE NAME. `client_name` is
   * caller-supplied on both mint paths, so a DCR app that registers itself
   * under the device client's display name must still classify as an OAuth
   * grant — otherwise a remote app could dress itself up as the operator's own
   * machine in the agent's own identity readout.
   */
  it("a DCR app impersonating the device client's NAME is still `oauth-app`", async () => {
    vi.mocked(supabaseAdmin).mockReturnValue(
      makeReader({
        id: "tok-1",
        user_id: "user-9",
        scopes: ["dopl.read"],
        access_expires_at: future,
        revoked_at: null,
        client_id: "dopl_client_someone_else",
        client_name: "Dopl Desktop (device tokens)",
      }) as never
    );
    expect(await validateAccessToken("dopl_at_deadbeef")).toMatchObject({
      credential: { kind: "oauth-app", label: "Dopl Desktop (device tokens)" },
    });
  });
});
