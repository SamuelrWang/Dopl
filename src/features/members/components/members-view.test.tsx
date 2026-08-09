import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  members: null as unknown[] | null,
  loading: true,
}));

vi.mock("../hooks/use-members", () => ({
  useMembers: () => ({
    members: state.members,
    loading: state.loading,
    error: null,
    refresh: () => {},
  }),
}));
vi.mock("../hooks/use-invitations", () => ({
  useInvitations: () => ({ invitations: [], refresh: () => {} }),
}));
vi.mock("../hooks/use-teams", () => ({
  useTeams: () => ({ teams: [], loading: false, error: null, refresh: () => {} }),
}));
vi.mock("../hooks/use-workspace-resources", () => ({
  useWorkspaceResources: () => ({
    resources: [],
    loading: false,
    error: null,
    refresh: () => {},
  }),
}));
vi.mock("../hooks/use-join-requests", () => ({
  useJoinRequests: () => ({ requests: [], resolve: async () => {} }),
}));

const { MembersView } = await import("./members-view");

/**
 * Cold arrival at the members console. It used to render the REAL panes with
 * `members = []` and therefore claim "No members yet." in a workspace that
 * always contains at least the person reading it, next to a detail pane
 * reading "Loading members…" — a false empty state beside a text loader.
 * It loads into the shared two-pane skeleton now.
 */
/**
 * The reads are mocked, but the console's WRITES are real mutation hooks now
 * (revoke invitation, resolve join request), and those take their client from
 * context — so the provider is part of mounting this component at all.
 */
function render() {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MembersView
        workspaceSlug="acme"
        workspaceId="w-1"
        currentUserId="u-me"
        myRole="admin"
      />
    </QueryClientProvider>
  );
}

describe("MembersView cold load", () => {
  it("never claims the workspace is empty before the roster answers", () => {
    state.members = null;
    state.loading = true;
    expect(render()).not.toContain("No members yet.");
  });

  it("adopts the shared two-pane skeleton — the shape it loads into", () => {
    state.members = null;
    state.loading = true;
    const html = render();
    expect(html).toContain("page-float");
    expect(html).toContain('data-slot="skeleton"');
    expect(html).toContain("Loading members");
  });

  it("drops the old text loader in the detail pane", () => {
    state.members = null;
    state.loading = true;
    expect(render()).not.toContain("Loading members…");
  });
});
