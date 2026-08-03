import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import KnowledgePage from "./index";
import KnowledgeDetailPage from "./detail";
import { WORKSPACE_ID } from "#/test-utils/bridge";

/**
 * Smoke test for the ported knowledge slice.
 *
 * The data layer is mocked at `window.dopl` — the ONE seam both clients sit
 * on. The SPA's transport picks the bridge over `fetch`, and so does the web
 * `api-client` that every reused knowledge module (`client/api.ts`,
 * `client/hooks.ts`) calls, so a single fake serves the whole tree and the
 * request log below is the real wire traffic. Its presence also puts the
 * reused components in desktop mode, where realtime and presence no-op.
 */

const USER_ID = "user-1";

const BASE_A = {
  id: "base-a",
  workspaceId: WORKSPACE_ID,
  name: "Product specs",
  slug: "product-specs",
  publicId: "aaaaaaaaaaaa",
  description: "What we ship",
  visibility: "private",
  accessMode: "workspace",
  agentWriteEnabled: false,
  createdBy: USER_ID,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};
const BASE_B = {
  ...BASE_A,
  id: "base-b",
  name: "Sales playbook",
  slug: "sales-playbook",
  publicId: "bbbbbbbbbbbb",
  description: "How we sell",
  createdBy: "user-2",
};

const ENTRY_1 = {
  id: "entry-1",
  baseId: "base-b",
  folderId: null,
  title: "Cold outreach",
  slug: "cold-outreach",
  body: "# Cold outreach\n\nOpen with the problem.",
  excerpt: "Open with the problem.",
  position: 0,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-02T00:00:00Z",
};
const ENTRY_2 = {
  ...ENTRY_1,
  id: "entry-2",
  title: "Discovery call",
  slug: "discovery-call",
  body: "# Discovery call\n\nAsk about the pain.",
  position: 1,
};

const NEW_BASE = {
  ...BASE_A,
  id: "base-c",
  name: "Onboarding",
  slug: "onboarding",
  publicId: "cccccccccccc",
  description: null,
};

const requests: Array<{ path: string; method: string }> = [];
/** Set once the create POST lands, so the list refetch reflects it. */
let created: typeof NEW_BASE | null = null;
/** Set once the slug PATCH lands, so the list refetch reflects it. */
let renamedB: typeof BASE_B | null = null;

function ok(body: unknown) {
  return { status: 200, statusText: "OK", hasBody: true, body };
}

function route(path: string) {
  if (path.startsWith("/api/workspaces/resolve")) {
    return ok({
      workspace: {
        id: WORKSPACE_ID,
        slug: "acme",
        publicId: "ab12cd34ef56",
        name: "Acme",
      },
      canonical: "acme-ab12cd34ef56",
      needsRedirect: false,
    });
  }
  if (path === "/api/workspaces/me") return ok({ role: "admin", userId: USER_ID });
  if (path === "/api/knowledge/bases") {
    return ok({
      bases: [BASE_A, renamedB ?? BASE_B, ...(created ? [created] : [])],
      ownerNames: { "user-2": "Dana Reed" },
    });
  }
  if (path === "/api/knowledge/bases/base-c/tree") {
    return ok({ base: created, folders: [], entries: [] });
  }
  if (path.endsWith("/teams")) {
    return ok({
      teams: [
        {
          id: "team-1",
          name: "Revenue",
          color: "#f00",
          grants: [
            {
              teamId: "team-1",
              resourceType: "knowledge_base",
              resourceId: "base-b",
              level: "edit",
            },
          ],
          memberIds: [],
        },
      ],
    });
  }
  if (path === "/api/knowledge/bases/base-b/tree") {
    return ok({ base: BASE_B, folders: [], entries: [ENTRY_1, ENTRY_2] });
  }
  if (path === "/api/knowledge/bases/base-a/tree") {
    return ok({ base: BASE_A, folders: [], entries: [] });
  }
  if (path === "/api/knowledge/entries/entry-1") return ok({ entry: ENTRY_1 });
  if (path === "/api/knowledge/entries/entry-2") return ok({ entry: ENTRY_2 });
  if (path.startsWith("/api/members/my-access")) return ok({ resources: [] });
  if (path === "/api/user/profile") return ok({ display_name: "Sam", email: "s@x.io" });
  return null;
}

const apiRequest = vi.fn((path: string, opts?: { method?: string }) => {
  requests.push({ path, method: opts?.method ?? "GET" });
  if (path === "/api/knowledge/bases/base-b" && opts?.method === "PATCH") {
    renamedB = { ...BASE_B, slug: "playbook-v2" };
    return Promise.resolve({
      status: 200,
      statusText: "OK",
      hasBody: true,
      body: { base: renamedB },
    });
  }
  if (path === "/api/knowledge/bases" && opts?.method === "POST") {
    created = NEW_BASE;
    return Promise.resolve({
      status: 201,
      statusText: "Created",
      hasBody: true,
      body: { base: NEW_BASE },
    });
  }
  const answer = route(path.split("?")[0]) ?? route(path);
  if (!answer) return Promise.reject(new Error(`unexpected request: ${path}`));
  return Promise.resolve(answer);
});

const paths = () => requests.map((r) => r.path);

const SEGMENT = "acme-ab12cd34ef56";
const BASE_A_SEG = "product-specs-aaaaaaaaaaaa";
const BASE_B_SEG = "sales-playbook-bbbbbbbbbbbb";
const NEW_BASE_SEG = "onboarding-cccccccccccc";
const RENAMED_B_SEG = "playbook-v2-bbbbbbbbbbbb";

/** Both knowledge rows, wired exactly as `routes.tsx` registers them. */
function renderAt(entry: string) {
  const router = createMemoryRouter(
    [
      { path: "/:workspaceSegment/knowledge", element: <KnowledgePage /> },
      { path: "/:workspaceSegment/knowledge/:kbSlug", element: <KnowledgeDetailPage /> },
    ],
    { initialEntries: [entry] }
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}

describe("knowledge index + KB detail", () => {
  beforeEach(() => {
    requests.length = 0;
    created = null;
    renamedB = null;
    // The controller persists the last-opened base per workspace; without
    // this, one test's selection auto-selects a different base in the next.
    localStorage.clear();
    vi.stubGlobal("dopl", {
      apiRequest,
      getAuthState: () => Promise.resolve({ signedIn: true, userId: USER_ID }),
      onAuthState: () => () => {},
      openExternal: () => Promise.resolve({ ok: true }),
    });
    // Nothing may reach the network; a call here is a bug, not a fallback.
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network"))));
  });

  it("lists the workspace's bases with foreign-owner attribution", async () => {
    renderAt(`/${SEGMENT}/knowledge`);

    // Scoped to the list pane's row buttons — the detail pane echoes the
    // auto-selected base's name too.
    expect(
      await screen.findByRole("button", { name: /Product specs/ })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sales playbook/ })).toBeInTheDocument();
    // `ownerNames` — the half that had no route until it was folded into
    // GET /api/knowledge/bases. Own bases carry no attribution.
    expect(screen.getByText("Dana Reed")).toBeInTheDocument();

    expect(paths()).toContain("/api/knowledge/bases");
    expect(paths()).toContain(`/api/workspaces/${SEGMENT}/teams`);
    // One request for the list, not one per consumer: the page's
    // useKnowledgeBaseList and the controller's useKnowledgeBases share a key.
    expect(paths().filter((p) => p === "/api/knowledge/bases")).toHaveLength(1);
  });

  it("selecting a base pushes its canonical URL WITHOUT remounting the view", async () => {
    const router = renderAt(`/${SEGMENT}/knowledge`);
    const salesRow = await screen.findByRole("button", { name: /Sales playbook/ });

    // Transient view state that only survives if the component instance does.
    fireEvent.change(screen.getByPlaceholderText("Search"), {
      target: { value: "sales" },
    });
    expect(
      screen.queryByRole("button", { name: /Product specs/ })
    ).not.toBeInTheDocument();

    fireEvent.click(salesRow);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/${SEGMENT}/knowledge/${BASE_B_SEG}`
      );
    });
    // The route match moved from the index row to the :kbSlug row. Both rows
    // render the same component type, so react-router reconciles instead of
    // remounting — the filter text and its effect are still here.
    expect(screen.getByPlaceholderText("Search")).toHaveValue("sales");
    expect(
      screen.queryByRole("button", { name: /Product specs/ })
    ).not.toBeInTheDocument();
  });

  it("Back returns to the previous base without a clobbering re-write", async () => {
    const router = renderAt(`/${SEGMENT}/knowledge`);
    // Every navigation the router performs, in order — the only way to prove
    // the write effect did NOT fire a second, stale one behind our back.
    const moves: string[] = [];
    router.subscribe((state) => {
      moves.push(`${state.historyAction} ${state.location.pathname}`);
    });

    await screen.findByRole("button", { name: /Sales playbook/ });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/${SEGMENT}/knowledge/${BASE_A_SEG}`);
    });
    // Auto-select is not a user navigation, so it REPLACES.
    expect(moves).toEqual([`REPLACE /${SEGMENT}/knowledge/${BASE_A_SEG}`]);

    fireEvent.click(screen.getByRole("button", { name: /Sales playbook/ }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/${SEGMENT}/knowledge/${BASE_B_SEG}`);
    });
    // A new base is one PUSH — not a push plus a corrective replace.
    expect(moves).toEqual([
      `REPLACE /${SEGMENT}/knowledge/${BASE_A_SEG}`,
      `PUSH /${SEGMENT}/knowledge/${BASE_B_SEG}`,
    ]);

    await router.navigate(-1);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/${SEGMENT}/knowledge/${BASE_A_SEG}`);
    });
    // The whole point: exactly ONE POP lands, and the write effect does not
    // re-assert the pre-Back selection over it or push a truncating entry.
    expect(moves).toEqual([
      `REPLACE /${SEGMENT}/knowledge/${BASE_A_SEG}`,
      `PUSH /${SEGMENT}/knowledge/${BASE_B_SEG}`,
      `POP /${SEGMENT}/knowledge/${BASE_A_SEG}`,
    ]);
    // And the view followed the URL, not just the address bar.
    expect(await screen.findByText("What we ship")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/${SEGMENT}/knowledge/${BASE_A_SEG}`);
  });

  it("selects a newly created base instead of dropping the navigation", async () => {
    const router = renderAt(`/${SEGMENT}/knowledge`);
    await screen.findByRole("button", { name: /Sales playbook/ });

    fireEvent.click(screen.getByLabelText("New knowledge base"));
    // ModalShell mounts a frame later (rAF-driven enter transition).
    fireEvent.change(await screen.findByPlaceholderText("e.g. Product specs"), {
      target: { value: "Onboarding" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    // The created base is seeded into the cached list before the URL moves,
    // so the controller can resolve the segment it is handed.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/${SEGMENT}/knowledge/${NEW_BASE_SEG}`
      );
    });
    // Selected, not merely listed. Selecting a base loads its tree, so that
    // request is the unambiguous proof: without the pre-navigation cache seed
    // the controller cannot resolve the segment it was handed and silently
    // drops the move, while the list row still appears via the refetch.
    await waitFor(() => {
      expect(paths()).toContain("/api/knowledge/bases/base-c/tree");
    });
    expect(screen.getAllByText("Onboarding")).toHaveLength(2);
  });

  it("keeps the renamed slug in the URL when the selection next changes", async () => {
    // A rename reaches this tree as a fresh `bases` row, never as a new
    // selection — so a URL built from the RAW selection keeps the old slug in
    // hand and re-asserts it the next time anything is selected.
    const router = renderAt(`/${SEGMENT}/knowledge/${BASE_B_SEG}`);
    await screen.findByDisplayValue("Cold outreach");

    fireEvent.click(screen.getByLabelText("Knowledge base settings"));
    fireEvent.click(await screen.findByText(/Show URL slug/));
    fireEvent.change(screen.getByDisplayValue("sales-playbook"), {
      target: { value: "playbook-v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/${SEGMENT}/knowledge/${RENAMED_B_SEG}`
      );
    });

    // Now move the selection. The URL must follow the RENAMED base.
    fireEvent.click(screen.getByText("Discovery call"));

    await waitFor(() => {
      expect(router.state.location.search).toBe("?entryId=entry-2");
    });
    expect(router.state.location.pathname).toBe(
      `/${SEGMENT}/knowledge/${RENAMED_B_SEG}`
    );
  });

  it("resolves a legacy slug arriving over history, not just on a cold load", async () => {
    // The controller's URL→selection handler and the page's deep-link
    // resolver must speak ONE grammar: a legacy slug-only URL pushed into
    // history has to select its base here exactly as it does on first paint.
    const router = renderAt(`/${SEGMENT}/knowledge`);
    await screen.findByRole("button", { name: /Sales playbook/ });

    await act(() => router.navigate(`/${SEGMENT}/knowledge/sales-playbook`));

    await waitFor(() => {
      expect(paths()).toContain("/api/knowledge/bases/base-b/tree");
    });
    expect(screen.getAllByText("Sales playbook")).toHaveLength(2);
  });

  it("resolves a deep link's base and its ?entryId= target", async () => {
    renderAt(`/${SEGMENT}/knowledge/${BASE_B_SEG}?entryId=entry-2`);

    expect(await screen.findByDisplayValue("Discovery call")).toBeInTheDocument();
    expect(paths()).toContain("/api/knowledge/bases/base-b/tree");
    expect(paths()).toContain("/api/knowledge/entries/entry-2");
  });

  it("falls back to the base's first entry when ?entryId= is not in its tree", async () => {
    renderAt(`/${SEGMENT}/knowledge/${BASE_B_SEG}?entryId=entry-from-another-base`);

    expect(await screen.findByDisplayValue("Cold outreach")).toBeInTheDocument();
    expect(paths()).not.toContain("/api/knowledge/entries/entry-from-another-base");
  });

  it("replaces a legacy KB slug with the canonical segment, keeping ?entryId=", async () => {
    const router = renderAt(`/${SEGMENT}/knowledge/sales-playbook?entryId=entry-2`);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/${SEGMENT}/knowledge/${BASE_B_SEG}`
      );
    });
    // The page's 301 preserved the query string; so must the replace that
    // stands in for it, or the deep link silently demotes to the base.
    expect(router.state.location.search).toBe("?entryId=entry-2");
    expect(await screen.findByDisplayValue("Discovery call")).toBeInTheDocument();
  });

  it("surfaces an unknown KB segment as the shared error card", async () => {
    renderAt(`/${SEGMENT}/knowledge/ghost-base`);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Knowledge base not found"
    );
  });
});
