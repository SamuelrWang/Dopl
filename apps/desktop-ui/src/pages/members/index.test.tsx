import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeResponse } from "#/lib/dopl-bridge";
import {
  SEGMENT,
  WORKSPACE_ID,
  bridgeCalls,
  installBridge,
  ok,
  renderWithProviders,
  workspaceRoutes,
} from "#/test-utils/bridge";
import MembersPage from "./index";

/**
 * Smoke test for the ported members page.
 *
 * The data layer is mocked at `window.dopl.apiRequest` — the Electron bridge —
 * rather than at `#/lib/api-transport`, because this page reads over BOTH
 * clients: the seam's `useWorkspaceAccess` goes through the SPA's transport
 * while every reused feature hook (`useMembers`, `useTeams`, the access matrix,
 * `MemberDetail`) goes through the WEB `apiRequest`. Both funnel into the same
 * bridge in the packaged app, so stubbing it exercises the real path once and
 * proves the "web api-client transports over IPC" claim for this page.
 *
 * `fetch` is stubbed as a never-resolving spy purely as a tripwire: nothing on
 * this page may reach it (`connect-src 'none'` in the packaged renderer).
 */

const apiRequest = vi.hoisted(() => vi.fn());

const ws = (path: string) => `/api/workspaces/${SEGMENT}${path}`;

const MEMBERS = [
  {
    workspaceId: WORKSPACE_ID,
    userId: "user-1",
    role: "owner",
    status: "active",
    joinedAt: "2026-01-01T00:00:00Z",
    invitedBy: null,
    invitedAt: null,
    lastSeenAt: "2026-08-02T00:00:00Z",
    email: "ada@acme.test",
    displayName: "Ada Lovelace",
    avatarUrl: null,
    teams: [],
  },
  {
    workspaceId: WORKSPACE_ID,
    userId: "user-2",
    role: "member",
    status: "active",
    joinedAt: "2026-02-01T00:00:00Z",
    invitedBy: "user-1",
    invitedAt: null,
    lastSeenAt: null,
    email: "grace@acme.test",
    displayName: "Grace Hopper",
    avatarUrl: null,
    teams: [],
  },
];

const TEAMS = [
  {
    id: "team-1",
    workspaceId: WORKSPACE_ID,
    name: "Revenue",
    description: null,
    color: "#8b5cf6",
    icon: null,
    createdBy: "user-1",
    createdAt: "2026-01-02T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    memberCount: 1,
    memberIds: ["user-1"],
    grants: [],
  },
];

const RESOURCES = [
  {
    resourceType: "knowledge_base",
    resourceId: "kb-1",
    name: "Sales playbook",
    accessMode: "workspace",
    createdBy: "user-1",
  },
];

const INVITATIONS = [
  {
    id: "inv-1",
    workspaceId: WORKSPACE_ID,
    email: "alan@acme.test",
    invitedRole: "member",
    invitedBy: "user-1",
    token: "tok",
    expiresAt: "2026-08-09T00:00:00Z",
    acceptedAt: null,
    revokedAt: null,
    createdAt: "2026-08-01T00:00:00Z",
    teamIds: [],
  },
];

/** Routes every path this page reads; anything else fails the test loudly. */
function defaultBridge(path: string): Promise<BridgeResponse> {
  const shared = workspaceRoutes(path);
  if (shared) return shared;
  if (path === ws("/members")) return Promise.resolve(ok({ members: MEMBERS }));
  if (path === ws("/invitations")) {
    return Promise.resolve(ok({ invitations: INVITATIONS }));
  }
  if (path === ws("/teams")) return Promise.resolve(ok({ teams: TEAMS }));
  if (path === ws("/access-matrix")) {
    return Promise.resolve(ok({ resources: RESOURCES }));
  }
  if (path === ws("/join-requests")) return Promise.resolve(ok({ requests: [] }));
  if (path === ws("/members/user-1/access")) {
    return Promise.resolve(ok({ defaultLevel: "edit", resources: [] }));
  }
  if (path === "/api/billing/status") {
    return Promise.resolve(ok({ plan: "team", status: "active", memberCount: 2 }));
  }
  return Promise.reject(new Error(`unexpected request: ${path}`));
}

const calls = () => bridgeCalls(apiRequest);

function renderPage() {
  return renderWithProviders(
    [{ path: "/:workspaceSegment/members", element: <MembersPage /> }],
    [`/${SEGMENT}/members`]
  );
}

describe("members page", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation((path: string) => defaultBridge(path));
    installBridge({ apiRequest });
  });

  it("resolves the workspace, then renders the roster off the bridge", async () => {
    renderPage();

    // Roster row + the detail pane the page auto-selects onto the first member.
    expect(await screen.findAllByText("Ada Lovelace")).not.toHaveLength(0);
    expect(
      await screen.findByRole("heading", { name: /Ada Lovelace/ })
    ).toBeInTheDocument();
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();

    const paths = calls().map((c) => c.path);
    // ONE read for workspace + role + caller id (P0-2), not three.
    expect(paths).toContain("/api/boot");
    expect(paths).not.toContain("/api/workspaces/me");
    expect(paths).toContain(ws("/members"));
    expect(paths).toContain(ws("/teams"));
    expect(paths).toContain(ws("/access-matrix"));
    // Admin-only queues are enabled because `me` reports owner.
    expect(paths).toContain(ws("/invitations"));
    expect(paths).toContain(ws("/join-requests"));
    // Nothing on this page may reach the network directly.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows the pending-invitation queue and revokes over the bridge", async () => {
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Revoke invitation for alan@acme.test",
      })
    );

    await waitFor(() =>
      expect(
        calls().some(
          (c) => c.path === ws("/invitations/inv-1") && c.opts.method === "DELETE"
        )
      ).toBe(true)
    );
  });

  it("switches to the teams tab and lists the workspace's teams", async () => {
    renderPage();
    await screen.findAllByText("Ada Lovelace");

    fireEvent.click(screen.getByRole("tab", { name: /Teams/ }));

    expect(await screen.findAllByText("Revenue")).not.toHaveLength(0);
    // The list pane swapped: the roster is gone and the search retargeted.
    expect(screen.queryByText("grace@acme.test · never active")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search teams")).toBeInTheDocument();
  });

  it("surfaces a failed workspace resolve as the shared page error", async () => {
    apiRequest.mockImplementation((path: string) =>
      path === "/api/boot"
        ? Promise.resolve({
            status: 404,
            statusText: "Not Found",
            hasBody: true,
            body: {
              error: { code: "WORKSPACE_NOT_FOUND", message: "Workspace not found" },
            },
          })
        : defaultBridge(path)
    );

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Workspace not found");
  });
});
