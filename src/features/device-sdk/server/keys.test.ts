/**
 * Device SDK API keys (C1): mint → verify by sha256 → revoke / rotate, over an in-memory
 * `dev_api_keys` that applies the real filters (`fake-dev-db.ts`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/supabase/admin", async () => {
  const m = await import("./fake-dev-db");
  return { supabaseAdmin: () => m.fakeDb };
});

import { fakeStore, resetFakeStore } from "./fake-dev-db";
import {
  generateApiKey,
  hashApiKey,
  keyPrefixFor,
  mintApiKey,
  normalizeScopes,
  revokeApiKey,
  rotateApiKey,
  sameHash,
  verifyApiKey,
} from "./keys";
import { API_KEY_PREFIX, parseApiKey } from "../types";

const PROJECT = "proj-1";
const ORG = "org-1";

beforeEach(() => {
  resetFakeStore();
  fakeStore.projects.set(PROJECT, { id: PROJECT, org_id: ORG, api_version: "2026-10-27" });
});

describe("hashing", () => {
  it("is lowercase hex sha256 and compares in constant time", () => {
    const h = hashApiKey("sk_test_abc");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(sameHash(h, hashApiKey("sk_test_abc"))).toBe(true);
    expect(sameHash(h, hashApiKey("sk_test_abd"))).toBe(false);
    expect(sameHash(h, "")).toBe(false);
    expect(sameHash(h, h.slice(0, 32))).toBe(false);
  });
});

describe("prefix / env mapping", () => {
  it("uses the contracts' literal prefixes", () => {
    expect(keyPrefixFor("secret", "test")).toBe(API_KEY_PREFIX.secret_test);
    expect(keyPrefixFor("secret", "live")).toBe(API_KEY_PREFIX.secret_live);
    expect(keyPrefixFor("publishable", "test")).toBe(API_KEY_PREFIX.publishable);
    expect(keyPrefixFor("publishable", "live")).toBe(API_KEY_PREFIX.publishable);
  });

  it("generates keys the contracts parse back to the same kind and env", () => {
    for (const env of ["test", "live"] as const) {
      const s = generateApiKey("secret", env);
      expect(parseApiKey(s.raw)).toEqual({ kind: "secret", env });
      expect(s.prefix).toBe(s.raw.slice(0, `sk_${env}_`.length + 4));
      expect(s.keyHash).toBe(hashApiKey(s.raw));
      const p = generateApiKey("publishable", env);
      expect(parseApiKey(p.raw)).toEqual({ kind: "publishable", env: null });
    }
  });

  it("never repeats a key", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateApiKey("secret", "test").raw));
    expect(seen.size).toBe(200);
  });

  it("forces publishable keys to `connect` and refuses any other scope", () => {
    expect(normalizeScopes("publishable")).toEqual(["connect"]);
    expect(() => normalizeScopes("publishable", ["devices:read"])).toThrow(/connect/);
    expect(normalizeScopes("secret")).toEqual(["connect", "devices:read", "actions:write", "analytics:read"]);
  });
});

describe("mint + verify", () => {
  it("stores only the hash and the display prefix, never the raw key", async () => {
    const { secret, key } = await mintApiKey({ projectId: PROJECT, env: "test", kind: "secret" });
    const stored = fakeStore.keys[0];
    expect(stored.key_hash).toBe(hashApiKey(secret));
    expect(JSON.stringify(fakeStore.keys)).not.toContain(secret);
    expect(key).not.toHaveProperty("key_hash");
    expect(secret.startsWith(key.prefix)).toBe(true);
  });

  it("resolves a minted key to its org, project and env", async () => {
    const { secret, key } = await mintApiKey({
      projectId: PROJECT,
      env: "live",
      kind: "secret",
      scopes: ["devices:read"],
    });
    const r = await verifyApiKey(secret);
    expect(r).toEqual({
      ok: true,
      resolved: {
        orgId: ORG,
        projectId: PROJECT,
        env: "live",
        apiVersion: "2026-10-27",
        key: { id: key.id, kind: "secret", scopes: ["devices:read"], prefix: key.prefix },
      },
    });
  });

  it("refuses a malformed or unknown key", async () => {
    expect(await verifyApiKey("nope")).toMatchObject({ ok: false, code: "unauthenticated" });
    expect(await verifyApiKey(generateApiKey("secret", "test").raw)).toMatchObject({
      ok: false,
      code: "unauthenticated",
    });
  });

  it("🔒 a TEST key cannot resolve a LIVE row (env isolation)", async () => {
    // Plant a live row whose hash is a test-prefixed key's hash: the lookup must still miss.
    const forged = generateApiKey("secret", "test");
    fakeStore.keys.push({
      id: "k-live",
      project_id: PROJECT,
      env: "live",
      kind: "secret",
      prefix: forged.prefix,
      key_hash: forged.keyHash,
      scopes: ["devices:read"],
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked_at: null,
      expires_at: null,
    });
    expect(await verifyApiKey(forged.raw)).toMatchObject({ ok: false, code: "unauthenticated" });

    // And a correctly-minted live key never answers as test.
    const live = await mintApiKey({ projectId: PROJECT, env: "live", kind: "secret" });
    const r = await verifyApiKey(live.secret);
    expect(r.ok && r.resolved.env).toBe("live");
  });

  it("refuses a revoked key", async () => {
    const { secret, key } = await mintApiKey({ projectId: PROJECT, env: "test", kind: "secret" });
    expect(await revokeApiKey({ projectId: PROJECT, keyId: key.id })).toBe(true);
    expect(await revokeApiKey({ projectId: PROJECT, keyId: key.id })).toBe(false); // idempotent
    expect(await verifyApiKey(secret)).toEqual({
      ok: false,
      code: "unauthenticated",
      message: "This API key has been revoked.",
      // The row was found: its project rides along for the event log (A2), never the handler.
      known: expect.objectContaining({ projectId: PROJECT, env: "test" }),
    });
  });

  it("revoke is scoped to the project", async () => {
    const { key } = await mintApiKey({ projectId: PROJECT, env: "test", kind: "secret" });
    expect(await revokeApiKey({ projectId: "other", keyId: key.id })).toBe(false);
  });

  it("refuses an expired key", async () => {
    const { secret } = await mintApiKey({ projectId: PROJECT, env: "test", kind: "secret" });
    fakeStore.keys[0].expires_at = new Date(Date.now() - 1000).toISOString();
    expect(await verifyApiKey(secret)).toEqual({
      ok: false,
      code: "unauthenticated",
      message: "This API key has expired.",
      // The row was found: its project rides along for the event log (A2), never the handler.
      known: expect.objectContaining({ projectId: PROJECT, env: "test" }),
    });
  });
});

describe("rotate", () => {
  it("mints a same-shape replacement and gives the old key an overlap window", async () => {
    const old = await mintApiKey({ projectId: PROJECT, env: "live", kind: "secret", scopes: ["actions:write"] });
    const now = new Date();
    const rotated = await rotateApiKey({ projectId: PROJECT, keyId: old.key.id, overlapMs: 3_600_000, now });

    expect(rotated.key.env).toBe("live");
    expect(rotated.key.scopes).toEqual(["actions:write"]);
    expect(rotated.secret).not.toBe(old.secret);
    expect(rotated.previous.expires_at).toBe(new Date(now.getTime() + 3_600_000).toISOString());

    // Both work during the overlap; the old one stops once it passes.
    expect((await verifyApiKey(old.secret)).ok).toBe(true);
    expect((await verifyApiKey(rotated.secret)).ok).toBe(true);
    expect((await verifyApiKey(old.secret, new Date(now.getTime() + 3_600_001))).ok).toBe(false);
  });

  it("refuses to rotate a revoked key", async () => {
    const old = await mintApiKey({ projectId: PROJECT, env: "test", kind: "secret" });
    await revokeApiKey({ projectId: PROJECT, keyId: old.key.id });
    await expect(rotateApiKey({ projectId: PROJECT, keyId: old.key.id })).rejects.toThrow(/revoked/);
  });
});
