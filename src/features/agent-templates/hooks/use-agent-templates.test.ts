// @vitest-environment jsdom
/**
 * ⚠⚠ THE DEV MOCK FALLBACK'S ONLY GATE-KEEPER (2026-08-23) ⚠⚠
 *
 * `../client/mock.ts` exists so the Agents page can be reviewed before
 * `supabase/migrations/20260822200000_agent_templates.sql` is applied. That is a
 * temporary affordance sitting in a SHIPPING code path, so the properties below
 * are the ones that keep it from becoming a customer-visible lie:
 *
 *  - **A PRODUCTION BUILD NEVER SUBSTITUTES FIXTURES.** The whole risk of this
 *    change in one sentence: an outage that renders seven invented agents to a
 *    real operator. `process.env.NODE_ENV` is a BUILD-TIME constant in both
 *    bundlers that compile this module, so the branch is gone from a shipped
 *    build — this test pins the behaviour that folding produces.
 *  - **A SUCCESSFUL `[]` IS A REAL ANSWER.** Falling back on an empty list would
 *    make the three real empty states unreachable forever (INVARIANTS §11 —
 *    UNKNOWN is not EMPTY).
 *  - **THE ERROR IS NEVER SWALLOWED.** The page's alert line is driven by the
 *    `error` this hook returns; fixtures sit under it, never instead of it.
 *
 * ⚠ `vi.stubEnv` rather than a module-level constant read at import time: the
 * production case has to be reachable from a test process whose own NODE_ENV is
 * "test", and a hoisted constant could not be moved after the fact.
 *
 * The transport is mocked — this file is about the fallback decision, not about
 * TanStack (the agent-templates core's rule for its own hooks).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
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
const { MOCK_AGENT_TEMPLATES } = await import("../client/mock");

function read(over: Partial<FakeQuery>) {
  Object.assign(query, { data: undefined, error: null, isPending: false }, over);
  return renderHook(() => useAgentTemplates("ws-1")).result.current;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the dev mock fallback", () => {
  it("substitutes fixtures when the list read FAILED and nothing is cached", () => {
    const result = read({ error: new Error("relation does not exist") });
    expect(result.isMockData).toBe(true);
    expect(result.templates).toBe(MOCK_AGENT_TEMPLATES);
    // All three panels populate, which is the whole point of the fixtures.
    expect(new Set(result.templates.map((t) => t.visibility))).toEqual(
      new Set(["private", "team", "workspace"])
    );
  });

  it("keeps returning the error, so the page still shows its alert", () => {
    const boom = new Error("relation does not exist");
    expect(read({ error: boom }).error).toBe(boom);
  });

  it("leaves a SUCCESSFUL empty list alone — that is a real answer", () => {
    const result = read({ data: [] });
    expect(result.isMockData).toBe(false);
    expect(result.templates).toEqual([]);
  });

  it("lets a real (even stale) answer win over the fixtures on a failed refetch", () => {
    const rows = [{ id: "tpl-real" }] as unknown as AgentTemplate[];
    const result = read({ data: rows, error: new Error("refetch failed") });
    expect(result.isMockData).toBe(false);
    expect(result.templates).toBe(rows);
  });
});

describe("never in a production build", () => {
  /**
   * ⚠ THE TEST THIS FILE EXISTS FOR. `process.env.NODE_ENV === "production"` is
   * folded to a literal by webpack and by vite, so in a shipped bundle the
   * fallback is not a branch that stays false — it is code that is not there.
   * This asserts the behaviour that folding produces.
   */
  it("shows the PLAIN error state on a failed read, exactly as before the mock existed", () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = read({ error: new Error("relation does not exist") });
    expect(result.isMockData).toBe(false);
    expect(result.templates).toEqual([]);
    expect(result.error).toBeInstanceOf(Error);
  });

  it("does not leak fixtures through any other production path", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const over of [
      { error: new Error("boom") },
      { data: undefined, error: new Error("boom") },
      { data: [], error: new Error("boom") },
      { isPending: true, error: new Error("boom") },
    ]) {
      expect(read(over).templates).not.toBe(MOCK_AGENT_TEMPLATES);
    }
  });
});
