// @vitest-environment jsdom
// Two workspaces' lists mounted side by side (F-331): a write must patch its own workspace's cache
// entry, never every variant of the path key (TanStack matches by prefix). Real `QueryClient` and
// hooks, fake network: the reader on the OTHER entry is what is under test.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { AgentIdentity } from "../client/types";

const WS_CONTAINER = "ws-container";
const WS_HOME = "ws-home";

function identity(id: string, workspaceId: string, name: string): AgentIdentity {
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

/** The server, keyed by workspace: the fence under test is client-side, so it never leaks rows. */
const rows: Record<string, AgentIdentity[]> = {};
/** Workspaces whose list read fails, so their cache entry holds no data (the `coldKeys` case). */
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
      return { identities: rows[workspaceId] ?? [] };
    }
    if (method === "POST") {
      const body = opts.body as { name: string };
      const created = identity("id-new", workspaceId, body.name);
      // Stored, so a refetch finds it: the cold-entry case's only path to the screen.
      rows[workspaceId] = [...(rows[workspaceId] ?? []), created];
      return { identity: created };
    }
    if (method === "PATCH") {
      const id = path.split("/").pop() as string;
      return { identity: identity(id, workspaceId, "Renamed") };
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

const { useAgentIdentities } = await import("./use-agent-identities");
const { useAgentIdentityWrites } = await import("./use-agent-identity-writes");

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
      container: useAgentIdentities(WS_CONTAINER),
      home: useAgentIdentities(WS_HOME),
      containerWrites: useAgentIdentityWrites(WS_CONTAINER),
      homeWrites: useAgentIdentityWrites(WS_HOME),
    }),
    { wrapper }
  );
}

/** Both lists warm before the write: a cold entry declines every patch and would hide the leak. */
async function warm() {
  const view = harness();
  await waitFor(() => {
    expect(view.result.current.container.loading).toBe(false);
    expect(view.result.current.home.loading).toBe(false);
  });
  return view;
}

const names = (list: readonly AgentIdentity[]) => list.map((t) => t.name);

beforeEach(() => {
  rows[WS_CONTAINER] = [identity("id-c1", WS_CONTAINER, "Channel Auditor")];
  rows[WS_HOME] = [identity("id-h1", WS_HOME, "Home Scout")];
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
    // Wait for the target list first: a `waitFor` on an absence passes before any patch lands.
    await waitFor(() =>
      expect(names(view.result.current.container.identities)).toEqual([
        "Channel Auditor",
        "New In Channel",
      ])
    );
    // Same `setQueriesData` call, so a prefix-key leak would already be visible here.
    expect(names(view.result.current.home.identities)).toEqual(["Home Scout"]);
  });

  it("UPDATE in the container never appends its row to the home list", async () => {
    const view = await warm();
    await act(async () => {
      await view.result.current.containerWrites.update.mutateAsync({
        identityId: "id-c1",
        body: { name: "Renamed" },
        optimistic: identity("id-c1", WS_CONTAINER, "Renamed"),
      });
    });
    await waitFor(() =>
      expect(names(view.result.current.container.identities)).toEqual(["Renamed"])
    );
    // Under a prefix key the optimistic patch and the reconcile would each append here.
    expect(names(view.result.current.home.identities)).toEqual(["Home Scout"]);
  });

  // F-747.
  it("UPDATE sends `expectedUpdatedAt` through to the request", async () => {
    const view = await warm();
    await act(async () => {
      await view.result.current.containerWrites.update.mutateAsync({
        identityId: "id-c1",
        body: { name: "Renamed" },
        optimistic: identity("id-c1", WS_CONTAINER, "Renamed"),
        expectedUpdatedAt: "2026-08-26T00:00:00.000Z",
      });
    });
    const patch = apiRequest.mock.calls.find(
      ([, opts]) => (opts as { method?: string })?.method === "PATCH"
    );
    expect(patch?.[1]).toMatchObject({
      expectedUpdatedAt: "2026-08-26T00:00:00.000Z",
    });
  });

  it("DELETE in the home list leaves the container list alone", async () => {
    const view = await warm();
    await act(async () => {
      await view.result.current.homeWrites.remove.mutateAsync({
        identityId: "id-h1",
      });
    });
    await waitFor(() =>
      expect(names(view.result.current.home.identities)).toEqual([])
    );
    // Not evidence: `dropRow` filters by id and ids never repeat across workspaces, so this passed
    // against the prefix-key bug too. Kept as a guard for the day ids stop being unique.
    expect(names(view.result.current.container.identities)).toEqual([
      "Channel Auditor",
    ]);
  });
});

describe("the cold-cache fallback is per workspace too", () => {
  // Over a prefix key a warm neighbour makes `coldKeys` answer "warm" for both, and the cold list
  // never refetches. Cold here = a failed read (no data), as a link container's 403/404 produces.
  it("refetches the list that was COLD at create time, beside a warm one", async () => {
    failingReads.add(WS_HOME);
    const view = harness();
    await waitFor(() => {
      expect(view.result.current.container.loading).toBe(false);
      expect(view.result.current.home.loading).toBe(false);
    });
    expect(view.result.current.home.error).not.toBeNull();
    expect(view.result.current.home.identities).toEqual([]);

    failingReads.delete(WS_HOME);
    rows[WS_HOME] = [];
    await act(async () => {
      await view.result.current.homeWrites.create.mutateAsync({
        body: { name: "First Ever" },
      });
    });
    // The reconcile had nothing to patch, so the `coldKeys` invalidation is the row's only path here.
    await waitFor(() =>
      expect(names(view.result.current.home.identities)).toEqual(["First Ever"])
    );
    expect(names(view.result.current.container.identities)).toEqual([
      "Channel Auditor",
    ]);
  });
});
