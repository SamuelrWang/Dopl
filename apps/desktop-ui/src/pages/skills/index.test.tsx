import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import type { TransportRequest } from "#/lib/api-transport";
import { WORKSPACE_ID, bootBody, installBridge } from "#/test-utils/bridge";
import { ToastHost } from "@/shared/ui/toast";
import SkillsPage from "./index";



const sendRequest = vi.hoisted(() => vi.fn());
vi.mock("#/lib/api-transport", () => ({ sendRequest }));

/** The recorded transport calls, typed — `vi.fn()` widens its args to any[]. */
const transportCalls = () =>
  sendRequest.mock.calls.map((args) => (args as unknown[])[0] as TransportRequest);

function skill(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "skill-1",
    workspaceId: WORKSPACE_ID,
    ownerId: "user-1",
    createdBy: "user-1",
    name: "Draft outreach",
    slug: "draft-outreach",
    description: "Writes a cold email",
    whenToUse: "always",
    whenNotToUse: null,
    status: "active",
    visibility: "private",
    accessMode: "workspace",
    grantedTeamIds: [],
    agentWriteEnabled: true,
    folder: "Sales",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-08T00:00:00Z",
    ...over,
  };
}

const SKILLS = [
  skill(),
  skill({ id: "skill-2", name: "Summarize call", slug: "summarize-call", folder: null }),
  skill({ id: "skill-3", name: "Triage inbox", slug: "triage-inbox", folder: null }),
];

/** `GET /api/skills/:slug` — the detail pane's payload for one row. */
function resolved(row: Record<string, unknown>) {
  return {
    skill: row,
    files: [
      {
        id: `file-${row.id}`,
        workspaceId: WORKSPACE_ID,
        skillId: row.id,
        name: "SKILL.md",
        body: `# ${row.name}`,
        position: 0,
        createdBy: "user-1",
        lastEditedBy: "user-1",
        lastEditedSource: "user",
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-08T00:00:00Z",
        deletedAt: null,
      },
    ],
    references: [],
  };
}

function ok(body: unknown) {
  return { status: 200, statusText: "OK", hasBody: true, body };
}

/** Routes every path this page reads; unknown paths fail loudly. */
function defaultTransport(req: TransportRequest) {
  // ONE read for workspace + role + caller id (P0-2): `/api/workspaces/me` is
  // no longer a hop the page waits on — `bootBody` carries what it answered.
  if (req.path === "/api/boot") return Promise.resolve(ok(bootBody()));
  if (req.path === "/api/skills") return Promise.resolve(ok({ skills: SKILLS }));
  const detail = SKILLS.find((s) => req.path === `/api/skills/${s.slug}`);
  if (detail) {
    // The hard delete answers 204 with no body (§2b — no trash, no restore).
    return req.method === "DELETE"
      ? Promise.resolve({ status: 204, statusText: "No Content", hasBody: false })
      : Promise.resolve(ok(resolved(detail)));
  }
  return Promise.reject(new Error(`unexpected request: ${req.method} ${req.path}`));
}

function renderPage() {
  const router = createMemoryRouter(
    [{ path: "/:workspaceSegment/skills", element: <SkillsPage /> }],
    { initialEntries: ["/acme-ab12cd/skills"] }
  );
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
      {/* The shell mounts this in the real app; the delete confirmation is a
          toast, so the page's own tree has to carry one here. */}
      <ToastHost />
    </QueryClientProvider>
  );
}

describe("skills index page", () => {
  beforeEach(() => {
    // SPA runtime marker: the shared web tree's SPA-mode guards (presence
    // no-op, realtime no-op, bridge identity) key off window.dopl. Without it
    // this suite would exercise the WEB paths and hide renderer crashes — the
    // exact failure a stubbed supabase module hid before. The bridge's
    // apiRequest funnels into the SAME sendRequest mock as the SPA transport,
    // so one mock serves both clients (exactly the packaged topology, where
    // both funnel into main). `installBridge` also arms the fetch tripwire.
    installBridge({
      apiRequest: (path: string, opts: Record<string, unknown> = {}) =>
        sendRequest({ path, ...opts }),
      getAuthState: () => Promise.resolve({ signedIn: false, userId: null }),
      onAuthState: () => () => {},
      openExternal: () => Promise.resolve({ ok: true }),
    });
    sendRequest.mockImplementation(defaultTransport);
  });

  it("resolves the workspace, then lists the workspace's skills", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Skills" })).toBeInTheDocument();
    expect(screen.getByText("Draft outreach")).toBeInTheDocument();
    expect(screen.getByText("Summarize call")).toBeInTheDocument();
    // Grouped by folder, unfiled last. Scoped to the <p> group headings —
    // the open skill's header also carries a "Sales" folder button.
    expect(screen.getByText("Sales", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Unfiled", { selector: "p" })).toBeInTheDocument();

    const paths = transportCalls().map((req) => req.path);
    expect(paths).toContain("/api/boot");
    // The `me` hop is gone — its answer rides on the boot response.
    expect(paths).not.toContain("/api/workspaces/me");
    expect(paths).toContain("/api/skills");

    // Every workspace-scoped read carries the RESOLVED id, not the caller's
    // default workspace — the header the web DetailPane comment calls out.
    const skillsCall = transportCalls().find((req) => req.path === "/api/skills");
    expect(skillsCall?.workspaceId).toBe(WORKSPACE_ID);
  });

  it("filters the list by the search field", async () => {
    renderPage();
    await screen.findByText("Draft outreach");

    fireEvent.change(screen.getByPlaceholderText("Search skills"), {
      target: { value: "summar" },
    });

    expect(screen.queryByText("Draft outreach")).not.toBeInTheDocument();
    expect(screen.getByText("Summarize call")).toBeInTheDocument();
  });

  it("selecting a row pulls that skill's full body by slug", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("Summarize call"));

    // The detail pane reads through the WEB api-client, whose SPA seam
    // routes over the bridge — one transport for both clients. Raw fetch
    // must never fire in SPA mode (the packaged CSP is connect-src 'none').
    await waitFor(() => {
      expect(sendRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/api/skills/summarize-call",
          workspaceId: WORKSPACE_ID,
        })
      );
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  // ── Permanent delete (§2b — trash and restore are gone) ────────────

  it("deletes the open skill behind a confirm dialog, then selects its neighbour", async () => {
    renderPage();

    // Open the MIDDLE row so "next" and "first" are different skills — the
    // whole point of the neighbour rule.
    fireEvent.click(await screen.findByText("Summarize call"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    // Nothing is sent until the dialog is confirmed.
    expect(
      await screen.findByText(
        "This permanently deletes the skill. This can't be undone."
      )
    ).toBeInTheDocument();
    expect(
      transportCalls().some((req) => req.method === "DELETE")
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => {
      expect(sendRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/api/skills/summarize-call",
          method: "DELETE",
          workspaceId: WORKSPACE_ID,
        })
      );
    });

    // The row leaves the list on the spot — note the mocked re-pull still
    // returns it, so this is the local hide, not the refetch.
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /^Summarize call/ })
      ).not.toBeInTheDocument();
    });
    // Selection moves to the NEXT row, not back to the top of the list.
    await waitFor(() => {
      expect(transportCalls().map((req) => req.path)).toContain(
        "/api/skills/triage-inbox"
      );
    });
    expect(screen.getByText("Skill deleted")).toBeInTheDocument();
  });

  it("keeps the skill when the delete fails, and says so", async () => {
    sendRequest.mockImplementation((req: TransportRequest) =>
      req.method === "DELETE"
        ? Promise.resolve({
            status: 500,
            statusText: "Internal Server Error",
            hasBody: true,
            body: { error: { code: "INTERNAL_ERROR", message: "Delete blew up" } },
          })
        : defaultTransport(req)
    );

    renderPage();
    fireEvent.click(await screen.findByText("Summarize call"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete permanently" })
    );

    expect(await screen.findByText("Couldn't delete")).toBeInTheDocument();
    // Row still there, dialog still open to retry or cancel.
    expect(
      screen.getByRole("button", { name: /^Summarize call/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete permanently" })
    ).toBeInTheDocument();
  });

  it("hides delete from a member who neither created the skill nor admins", async () => {
    sendRequest.mockImplementation((req: TransportRequest) =>
      req.path === "/api/boot"
        ? Promise.resolve(ok(bootBody({ role: "member", userId: "someone-else" })))
        : defaultTransport(req)
    );

    renderPage();
    fireEvent.click(await screen.findByText("Summarize call"));

    // Editing affordances stay (the server lets any member edit a shared
    // skill); the permanent delete is owner/admin only.
    expect(await screen.findByRole("button", { name: "Duplicate" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("surfaces a failed workspace resolve as the shared page error", async () => {
    sendRequest.mockImplementation((req: TransportRequest) =>
      req.path === "/api/boot"
        ? Promise.resolve({
            status: 404,
            statusText: "Not Found",
            hasBody: true,
            body: { error: { code: "WORKSPACE_NOT_FOUND", message: "Workspace not found" } },
          })
        : defaultTransport(req)
    );

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Workspace not found");
  });
});
