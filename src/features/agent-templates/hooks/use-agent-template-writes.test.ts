// @vitest-environment jsdom
/**
 * 🔴 THE TWO-WORKSPACE CACHE PIN (F-331).
 *
 * Every other write test in this tree drives configs through TanStack's
 * `MutationObserver` and asserts the CACHE. This one renders BOTH READS as well,
 * because the defect it exists for is invisible from one workspace: the three
 * write configs used to patch `agentTemplateKeys.list().all` — the one-element
 * PATH key — and TanStack matches by array prefix, so every patch landed on
 * EVERY workspace variant of `/api/agent-templates`. One mounted workspace never
 * notices. The /home Agents tab mounts two (a channel CONTAINER and the home
 * workspace, side by side), and then:
 *
 *   - a template created in the container APPEARS under "across all channels",
 *     because `upsertRow` APPENDS when the id is not in the cache it is handed;
 *   - an EDIT is worse than the create: the update path patches twice
 *     (optimistic + reconcile) and both appends, so an unrelated workspace's
 *     list grows a row it has no read access to until a cold refetch.
 *
 * ⚠ **THE THREE ASSERTIONS ARE NOT EQUALLY SHARP, AND SAYING SO IS THE POINT.**
 * Create and update go RED against the prefix key; the delete case does NOT,
 * and it is kept anyway as the regression guard for the day ids stop being
 * unique per workspace — `dropRow` filters by ID, and two workspaces never share
 * one, so a prefix DELETE patch is a no-op next door by accident rather than by
 * design. A test whose colour is an accident is documented as one rather than
 * counted as evidence (INVARIANTS §14).
 *
 * ⚠ REAL `QueryClient`, REAL HOOKS, MOCKED TRANSPORT. What is being pinned is
 * which cache entry a patch lands in and what a reader mounted on the OTHER
 * entry then projects — so the reader has to be the real `useAgentTemplates`
 * and the cache has to be the real one. Only the network is fake.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { AgentTemplate } from "../client/types";

const WS_CONTAINER = "ws-container";
const WS_HOME = "ws-home";

function template(id: string, workspaceId: string, name: string): AgentTemplate {
  return {
    id,
    workspaceId,
    name,
    description: null,
    instructions: null,
    model: null,
    fields: [],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [],
    createdBy: "u-me",
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
}

/** The server, keyed by workspace — the fence this test is about is CLIENT-side,
 *  so the server here simply never returns another workspace's rows. */
const rows: Record<string, AgentTemplate[]> = {};
/** Workspaces whose LIST READ is currently failing, so their cache entry holds
 *  no data — the cold-entry condition `coldKeys` exists for. */
const failingReads = new Set<string>();

const apiRequest = vi.fn(
  async (
    path: string,
    opts: { method?: string; workspaceId?: string; body?: unknown } = {}
  ) => {
    const method = opts.method ?? "GET";
    const workspaceId = opts.workspaceId ?? "";
    if (method === "GET") {
      if (failingReads.has(workspaceId)) throw new Error("forbidden");
      return { templates: rows[workspaceId] ?? [] };
    }
    if (method === "POST") {
      const body = opts.body as { name: string };
      const created = template("tpl-new", workspaceId, body.name);
      // The row EXISTS server-side from here on, so a refetch can find it —
      // which is the only way the cold-entry case below can reach the screen.
      rows[workspaceId] = [...(rows[workspaceId] ?? []), created];
      return { template: created };
    }
    if (method === "PATCH") {
      const id = path.split("/").pop() as string;
      return { template: template(id, workspaceId, "Renamed") };
    }
    return undefined;
  }
);

vi.mock("@/shared/api/api-client", () => ({
  apiRequest: (...args: unknown[]) =>
    (apiRequest as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
  ApiError: class ApiError extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      message: string
    ) {
      super(message);
    }
  },
}));

const { useAgentTemplates } = await import("./use-agent-templates");
const { useAgentTemplateWrites } = await import("./use-agent-template-writes");

function harness() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return renderHook(
    () => ({
      container: useAgentTemplates(WS_CONTAINER),
      home: useAgentTemplates(WS_HOME),
      containerWrites: useAgentTemplateWrites(WS_CONTAINER),
      homeWrites: useAgentTemplateWrites(WS_HOME),
    }),
    { wrapper }
  );
}

/** BOTH lists warm before the write — a cold entry declines every patch, which
 *  would hide the very leak this file is about. */
async function warm() {
  const view = harness();
  await waitFor(() => {
    expect(view.result.current.container.loading).toBe(false);
    expect(view.result.current.home.loading).toBe(false);
  });
  return view;
}

const names = (list: AgentTemplate[]) => list.map((t) => t.name);

beforeEach(() => {
  rows[WS_CONTAINER] = [template("tpl-c1", WS_CONTAINER, "Channel Auditor")];
  rows[WS_HOME] = [template("tpl-h1", WS_HOME, "Home Scout")];
});

afterEach(() => {
  apiRequest.mockClear();
  failingReads.clear();
});

describe("a write patches ONE workspace's list", () => {
  it("CREATE in the container never reaches the home list", async () => {
    const view = await warm();
    await act(async () => {
      await view.result.current.containerWrites.create.mutateAsync({
        body: { name: "New In Channel" },
      });
    });
    // ⚠ ORDER MATTERS: wait for the TARGET list to show the row FIRST, then
    // assert the other one does not. A `waitFor` on an ABSENCE passes before the
    // patch has been applied at all and would prove nothing.
    await waitFor(() =>
      expect(names(view.result.current.container.templates)).toEqual([
        "Channel Auditor",
        "New In Channel",
      ])
    );
    // 🔴 The assertion the fix exists for: under the PATH-prefix key this list
    // grew "New In Channel", a template of a workspace it cannot read — in the
    // SAME `setQueriesData` call, so by the line above it is already there.
    expect(names(view.result.current.home.templates)).toEqual(["Home Scout"]);
  });

  it("UPDATE in the container never appends its row to the home list", async () => {
    const view = await warm();
    await act(async () => {
      await view.result.current.containerWrites.update.mutateAsync({
        templateId: "tpl-c1",
        body: { name: "Renamed" },
        optimistic: template("tpl-c1", WS_CONTAINER, "Renamed"),
      });
    });
    await waitFor(() =>
      expect(names(view.result.current.container.templates)).toEqual(["Renamed"])
    );
    // Both the optimistic patch and the reconcile ran; under the prefix key each
    // one APPENDED (the id is absent here), so this list held "Renamed" twice.
    expect(names(view.result.current.home.templates)).toEqual(["Home Scout"]);
  });

  it("DELETE in the home list leaves the container list alone", async () => {
    const view = await warm();
    await act(async () => {
      await view.result.current.homeWrites.remove.mutateAsync({
        templateId: "tpl-h1",
      });
    });
    await waitFor(() =>
      expect(names(view.result.current.home.templates)).toEqual([])
    );
    // ⚠ COMPANION, NOT EVIDENCE — see the header: `dropRow` filters by id and
    // ids do not repeat across workspaces, so this passed against the bug too.
    expect(names(view.result.current.container.templates)).toEqual([
      "Channel Auditor",
    ]);
  });
});

describe("the cold-cache fallback is per workspace too", () => {
  /**
   * `coldKeys` over the PREFIX asks "does ANY VARIANT of this path hold data",
   * so a warm workspace beside a cold one answers "warm" for BOTH — and the cold
   * list, whose reconcile had nothing to patch, never refetches the row just
   * created in it. Over the ENTRY key it answers about that workspace alone.
   *
   * ⚠ The cold half here is a FAILED read rather than a contrived eviction: an
   * entry whose query errored holds no data, which is the same condition as the
   * cold start and the IndexedDB restore window, and it is the one a link
   * container actually produces (a 403/404 there is ordinary).
   */
  it("refetches the list that was COLD at create time, beside a warm one", async () => {
    failingReads.add(WS_HOME);
    const view = harness();
    await waitFor(() => {
      expect(view.result.current.container.loading).toBe(false);
      expect(view.result.current.home.loading).toBe(false);
    });
    expect(view.result.current.home.error).not.toBeNull();
    expect(view.result.current.home.templates).toEqual([]);

    failingReads.delete(WS_HOME);
    rows[WS_HOME] = [];
    await act(async () => {
      await view.result.current.homeWrites.create.mutateAsync({
        body: { name: "First Ever" },
      });
    });
    // Reconcile declined (nothing to patch), so the invalidation `coldKeys`
    // named is the ONLY path this row has to the screen.
    await waitFor(() =>
      expect(names(view.result.current.home.templates)).toEqual(["First Ever"])
    );
    expect(names(view.result.current.container.templates)).toEqual([
      "Channel Auditor",
    ]);
  });
});
