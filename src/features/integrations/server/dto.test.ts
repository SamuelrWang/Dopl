import { describe, it, expect } from "vitest";
import { mapOAuthConnectionRow, type OAuthConnectionRow } from "./dto";

const baseRow: OAuthConnectionRow = {
  id: "11111111-1111-1111-1111-111111111111",
  user_id: "user-1",
  provider: "notion",
  alias: "user@example.com",
  composio_connection_id: "cc_secret_abc123",
  status: "connected",
  account_email: "user@example.com",
  account_label: null,
  account_avatar_url: null,
  scopes: ["read_pages"],
  last_used_at: "2026-05-04T00:00:00Z",
  created_at: "2026-05-04T00:00:00Z",
  updated_at: "2026-05-04T00:00:00Z",
};

describe("mapOAuthConnectionRow", () => {
  it("maps every domain field from snake_case to camelCase", () => {
    const result = mapOAuthConnectionRow(baseRow);
    expect(result).toEqual({
      id: baseRow.id,
      userId: "user-1",
      provider: "notion",
      alias: "user@example.com",
      status: "connected",
      accountEmail: "user@example.com",
      accountLabel: null,
      accountAvatarUrl: null,
      scopes: ["read_pages"],
      lastUsedAt: baseRow.last_used_at,
      createdAt: baseRow.created_at,
      updatedAt: baseRow.updated_at,
    });
  });

  it("never leaks the broker connection id into the domain object", () => {
    const result = mapOAuthConnectionRow(baseRow);
    expect(JSON.stringify(result)).not.toContain("cc_secret_abc123");
    expect(result).not.toHaveProperty("composio_connection_id");
    expect(result).not.toHaveProperty("brokerConnectionId");
  });

  it("falls back to an empty array when scopes is null", () => {
    const result = mapOAuthConnectionRow({ ...baseRow, scopes: null });
    expect(result.scopes).toEqual([]);
  });

  it("throws on an unknown provider", () => {
    expect(() =>
      mapOAuthConnectionRow({ ...baseRow, provider: "linkedin" })
    ).toThrow(/Unknown integration provider/);
  });

  it("throws on an unknown status", () => {
    expect(() =>
      mapOAuthConnectionRow({ ...baseRow, status: "weird" })
    ).toThrow(/Unknown integration status/);
  });
});
