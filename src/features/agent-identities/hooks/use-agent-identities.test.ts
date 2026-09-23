// @vitest-environment jsdom
/**
 * WHAT THE LIST HOOK ANSWERS WITH — and, since 2026-08-26, what it must NEVER
 * answer with.
 *
 * ⚠ THIS FILE WAS THE DEV MOCK FALLBACK'S GATE-KEEPER AND IS NOW ITS EPITAPH
 * (F-332, ✅ RESOLVED). `../client/mock.ts` and the `isMockFallback` branch were
 * written while `20260822200000_agent_templates.sql` was unapplied; it is
 * applied (INVARIANTS §5A, §12), and on a link CONTAINER a 403/404 from this
 * endpoint is a NORMAL answer — so the branch had become a dev build painting
 * fabricated templates under a channel that has none. The file is **rewritten
 * down to the properties that survive the deletion, not removed** (INVARIANTS
 * §14): three of the four were always about the hook rather than the fixtures,
 * and the fourth — the plain error state — was the production-only case and is
 * now the ONLY case.
 *
 *  - **A FAILED READ RENDERS EMPTY PLUS THE ERROR, IN EVERY BUILD.** Nothing is
 *    substituted for a failure, so there is no build in which this surface shows
 *    rows the server did not send.
 *  - **A SUCCESSFUL `[]` IS A REAL ANSWER**, distinct from a failure, so the
 *    real empty states stay reachable (INVARIANTS §11 — UNKNOWN is not EMPTY).
 *  - **THE ERROR IS NEVER SWALLOWED.** The page's alert line is driven by the
 *    `error` this hook returns.
 *  - **A REAL (EVEN STALE) ANSWER SURVIVES A FAILED REFETCH.**
 *
 * The transport is mocked — this file is about what the hook projects, not about
 * TanStack (the agent-templates core's rule for its own hooks).
 */

import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { AgentTemplate } from "../client/types";

interface FakeQuery {
  data: AgentTemplate[] | undefined;
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

const { useAgentTemplates } = await import("./use-agent-templates");

function read(over: Partial<FakeQuery>) {
  Object.assign(query, { data: undefined, error: null, isPending: false }, over);
  return renderHook(() => useAgentTemplates("ws-1")).result.current;
}

describe("a failed read is a failed read", () => {
  /**
   * ⚠ THE TEST THIS FILE NOW EXISTS FOR. A 403 or 404 on this endpoint is an
   * ORDINARY answer on a link container (a roster change, a stale header, a
   * guest opening the tab); the surface must render the plain error state and
   * NOTHING else, with no dev/production asymmetry to reason about.
   */
  it("renders the PLAIN error state — no rows, error intact", () => {
    const boom = new Error("forbidden");
    const result = read({ error: boom });
    expect(result.templates).toEqual([]);
    expect(result.error).toBe(boom);
  });

  it("leaves a SUCCESSFUL empty list alone — that is a real answer", () => {
    const result = read({ data: [] });
    expect(result.templates).toEqual([]);
    expect(result.error).toBeNull();
  });

  it("lets a real (even stale) answer win on a failed refetch", () => {
    const rows = [{ id: "tpl-real" }] as unknown as AgentTemplate[];
    const result = read({ data: rows, error: new Error("refetch failed") });
    expect(result.templates).toBe(rows);
  });

  it("reports the read as pending while it is in flight", () => {
    expect(read({ isPending: true }).loading).toBe(true);
  });
});
