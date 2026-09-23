// @vitest-environment jsdom
// Nothing is substituted for a failed read, in any build (INVARIANTS §11: unknown is not empty).

import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { AgentIdentity } from "../client/types";

interface FakeQuery {
  data: AgentIdentity[] | undefined;
  error: unknown;
  isPending: boolean;
  refetch: () => void;
}

const query: FakeQuery = {
  data: undefined,
  error: null,
  isPending: false,
  refetch: () => {},
};

vi.mock("@/shared/hooks/use-api-query", () => ({
  useApiQuery: () => query,
}));

const { useAgentIdentities } = await import("./use-agent-identities");

function read(over: Partial<FakeQuery>) {
  Object.assign(query, { data: undefined, error: null, isPending: false }, over);
  return renderHook(() => useAgentIdentities("ws-1")).result.current;
}

describe("a failed read is a failed read", () => {
  // A 403/404 here is an ordinary answer on a link container, so no fallback rows may appear.
  it("renders the PLAIN error state — no rows, error intact", () => {
    const boom = new Error("forbidden");
    const result = read({ error: boom });
    expect(result.identities).toEqual([]);
    expect(result.error).toBe(boom);
  });

  it("leaves a SUCCESSFUL empty list alone — that is a real answer", () => {
    const result = read({ data: [] });
    expect(result.identities).toEqual([]);
    expect(result.error).toBeNull();
  });

  it("lets a real (even stale) answer win on a failed refetch", () => {
    const rows = [{ id: "id-real" }] as unknown as AgentIdentity[];
    const result = read({ data: rows, error: new Error("refetch failed") });
    expect(result.identities).toBe(rows);
  });

  it("reports the read as pending while it is in flight", () => {
    expect(read({ isPending: true }).loading).toBe(true);
  });
});
