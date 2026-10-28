import { describe, expect, it } from "vitest";

import { API_KEY_SCOPES, ApiKeySchema, parseApiKey } from "./keys.js";
import { NOW, expectRoundTrip } from "./test-fixtures.js";

const KEY = {
  id: "key_1",
  project_id: "proj_1",
  kind: "secret" as const,
  env: "live" as const,
  prefix: "sk_live_4fQa",
  scopes: ["devices:read", "actions:write"] as ("devices:read" | "actions:write")[],
  created_at: NOW,
  last_used_at: null,
  revoked_at: null,
  expires_at: null,
};

describe("C1 keys", () => {
  it("scopes are the spec's four", () => {
    expect(API_KEY_SCOPES).toEqual(["connect", "devices:read", "actions:write", "analytics:read"]);
  });

  it("round-trips a key row", () => {
    expectRoundTrip(ApiKeySchema, KEY);
  });

  it("a publishable key carries connect only", () => {
    expect(ApiKeySchema.safeParse({ ...KEY, kind: "publishable", scopes: ["connect"] }).success).toBe(true);
    expect(ApiKeySchema.safeParse({ ...KEY, kind: "publishable", scopes: ["actions:write"] }).success).toBe(false);
  });

  it("parses key prefixes", () => {
    expect(parseApiKey("sk_test_abcdefghijklmnop")).toEqual({ kind: "secret", env: "test" });
    expect(parseApiKey("sk_live_abcdefghijklmnop")).toEqual({ kind: "secret", env: "live" });
    expect(parseApiKey("pk_abcdefghijklmnop")).toEqual({ kind: "publishable", env: null });
    expect(parseApiKey("sk_prod_abcdefghijklmnop")).toBeNull();
    expect(parseApiKey("sk_test_short")).toBeNull();
  });
});
