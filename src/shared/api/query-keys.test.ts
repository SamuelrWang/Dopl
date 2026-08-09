/**
 * The key factory's ONE job: produce the same tuple `useApiQuery` registers,
 * and a prefix that reaches every variant of it. A key that differs by one
 * element is a silent no-op — the optimistic write lands in a cache entry no
 * observer is subscribed to, nothing renders, and nothing fails — so both
 * halves are pinned here AND against TanStack's own matcher.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { QueryClient } from "@tanstack/react-query";
import { apiPathKey, apiQueryKey, apiResource } from "./query-keys";

describe("apiQueryKey", () => {
  it("is exactly [path, workspaceId, query]", () => {
    expect(apiQueryKey("/api/x", { workspaceId: "ws", query: { limit: 2 } })).toEqual([
      "/api/x",
      "ws",
      { limit: 2 },
    ]);
    expect(apiQueryKey("/api/x")).toEqual(["/api/x", undefined, undefined]);
  });

  it("matches the tuple use-api-query-core builds, read off its source", () => {
    // The two must agree forever; the whole layer rests on it. Reading the
    // source is the only assertion available in a DOM-free suite, and it is
    // the one that fails if that line is ever reordered.
    const core = readFileSync(
      new URL("../hooks/use-api-query-core.ts", import.meta.url),
      "utf8"
    );
    expect(core).toContain("queryKey: [path, opts.workspaceId, opts.query]");
  });
});

describe("apiPathKey / apiResource", () => {
  it("reaches every workspace and query-param variant of one path", () => {
    const client = new QueryClient();
    client.setQueryData(apiQueryKey("/api/channels", { workspaceId: "a" }), 1);
    client.setQueryData(
      apiQueryKey("/api/channels", {
        workspaceId: "a",
        query: { include: "archived" },
      }),
      2
    );
    client.setQueryData(apiQueryKey("/api/channels", { workspaceId: "b" }), 3);
    const matched = client
      .getQueriesData({ queryKey: apiPathKey("/api/channels") })
      .map(([, value]) => value)
      .sort();
    expect(matched).toEqual([1, 2, 3]);
  });

  it("does NOT match a longer path that merely starts with the same string", () => {
    // Key matching is per-ARRAY-ELEMENT, not per-character: `/api/channels`
    // must never patch `/api/channels/consent`. If it did, a channel-list
    // write would silently clobber the consent inbox.
    const client = new QueryClient();
    client.setQueryData(apiQueryKey("/api/channels/consent", {}), "consent");
    expect(
      client.getQueriesData({ queryKey: apiPathKey("/api/channels") })
    ).toHaveLength(0);
  });

  it("exposes both shapes for one resolved path", () => {
    const resource = apiResource("/api/skills");
    expect(resource.path).toBe("/api/skills");
    expect(resource.all).toEqual(["/api/skills"]);
    expect(resource.entry({ workspaceId: "ws" })).toEqual([
      "/api/skills",
      "ws",
      undefined,
    ]);
  });
});
