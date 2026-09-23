import { fireEvent, screen } from "@testing-library/react";
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
import AgentsPage from "./index";

/**
 * Agents page smoke test: the REAL `AgentTemplatesCore` over a mocked bridge, on
 * the same route row `routes.tsx` registers.
 *
 * ⚠ Stubbed at `window.dopl.apiRequest` rather than at the SPA transport, for
 * the reason `test-utils/bridge.tsx` gives: this page reads over BOTH clients —
 * the SPA's `apiRequest` (workspace access) and the reused WEB feature clients
 * (`useApiQuery` over `@/shared/api/api-client`, plus the knowledge and teams
 * hooks) — and in the packaged app both funnel into this one bridge.
 *
 * ⚠ THE WORKSPACE HEADER IS PART OF THE CONTRACT. `/api/agent-templates` is
 * workspace-scoped; a read that forgot `x-workspace-id` fails closed on a caller
 * with more than one workspace and works fine for everybody testing it.
 */

const apiRequest = vi.hoisted(() => vi.fn());
const calls = () => bridgeCalls(apiRequest);

const TEMPLATES = [
  {
    id: "tpl-1",
    name: "Release captain",
    description: "Runs the checklist",
    instructions: null,
    model: "claude-opus-5",
    fields: [],
    visibility: "private",
    teamId: null,
    knowledgeBases: [],
    createdBy: "user-1",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  },
  {
    id: "tpl-2",
    name: "Docs bot",
    description: null,
    instructions: null,
    model: null,
    fields: [],
    visibility: "workspace",
    teamId: null,
    knowledgeBases: [],
    createdBy: "user-1",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  },
];

/**
 * 🔴 THE /home SHELF, ANSWERED ONLY WHEN NOBODY NARROWS (Samuel's ruling
 * 2026-08-27). This page must send `?shelf=workspace` and therefore never see
 * it; a page that forgot the param falls into the "both" branch below and picks
 * it up, which is what makes the exclusion pin cost something.
 */
const HOME_SHELF_TEMPLATE = {
  ...TEMPLATES[0],
  id: "tpl-home-shelf",
  name: "Kept on /home",
  visibility: "private" as const,
};

function agentRoutes(path: string): Promise<BridgeResponse> | null {
  const [bare, query] = path.split("?");
  if (bare === "/api/agent-templates") {
    const shelf = new URLSearchParams(query ?? "").get("shelf");
    // ⚠ ABSENT = BOTH, mirroring the route (`?shelf=` absent means no filter).
    const templates =
      shelf === "workspace"
        ? TEMPLATES
        : shelf === "home"
          ? [HOME_SHELF_TEMPLATE]
          : [...TEMPLATES, HOME_SHELF_TEMPLATE];
    return Promise.resolve(ok({ templates }));
  }
  if (bare === "/api/knowledge/bases") {
    return Promise.resolve(ok({ bases: [{ id: "kb-1", name: "Runbooks" }] }));
  }
  if (bare.endsWith("/teams")) return Promise.resolve(ok({ teams: [] }));
  return null;
}

function renderAgents() {
  return renderWithProviders(
    [{ path: "/:workspaceSegment/agents", element: <AgentsPage /> }],
    [`/${SEGMENT}/agents`]
  );
}

describe("agents page", () => {
  beforeEach(() => {
    // ⚠ `vi.hoisted` mocks sit outside vitest's `restoreMocks` sweep.
    apiRequest.mockReset();
    apiRequest.mockImplementation((path: string) => {
      const answer = workspaceRoutes(path) ?? agentRoutes(path);
      return answer ?? Promise.resolve(ok({}));
    });
    installBridge({ apiRequest });
  });

  it("resolves the workspace, then renders the three scope panels", async () => {
    renderAgents();

    expect(await screen.findByText("Release captain")).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Private", "Team", "Public"]);

    // Grouped by the row's own `visibility`, not by anything this page decides.
    expect(screen.getByRole("region", { name: "Private" }).textContent).toContain(
      "Release captain"
    );
    expect(screen.getByRole("region", { name: "Public" }).textContent).toContain("Docs bot");
    expect(screen.getByRole("region", { name: "Team" }).textContent).toContain(
      "No team templates yet."
    );
  });

  it("reads the list workspace-scoped, over the bridge and never over fetch", async () => {
    renderAgents();
    await screen.findByText("Release captain");

    const list = calls().find(
      (c) => c.path.split("?")[0] === "/api/agent-templates"
    );
    expect(list).toBeTruthy();
    expect(list!.opts.workspaceId).toBe(WORKSPACE_ID);
    // 🔒 AND THE SHELF IS ON THE WIRE. It is what excludes templates created
    // from the /home Agents pane — a SERVER filter, so this asserts the
    // request, not the absence of a card (an absent card also happens when the
    // fixture forgets to send one).
    expect(list!.path).toContain("shelf=workspace");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("🔒 leaves the /home SHELF out of the workspace page", async () => {
    // 🔒 SAMUEL'S RULING, 2026-08-27 — the two surfaces are two PLACES and the
    // exclusion runs BOTH ways. `Kept on /home` is the same workspace, the same
    // owner and also private; only `?shelf=workspace` keeps it off this page.
    renderAgents();
    await screen.findByText("Release captain");

    expect(screen.queryByText("Kept on /home")).toBeNull();
  });

  it("opens the editor from the page-level create button", async () => {
    renderAgents();
    await screen.findByText("Release captain");

    fireEvent.click(screen.getByRole("button", { name: "New template" }));
    // ⚠ `ModalShell` mounts a FRAME after `open` flips (it animates in).
    expect(
      await screen.findByRole("dialog", { name: "New template" })
    ).toBeInTheDocument();
  });
});
