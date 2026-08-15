import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AccessMatrixResource, TeamView } from "@/features/teams/types";
import type { WorkspaceMemberView } from "../types";
import { MembersListPane } from "./members-list-pane";

/** ⚠ An unanswered query is not an empty workspace: with `members = []` in
 *  flight the pane must ghost rows, not claim "No members yet." in a workspace
 *  that always contains at least the reader. */

function member(over: Partial<WorkspaceMemberView> = {}): WorkspaceMemberView {
  return {
    userId: "u-1",
    email: "ada@example.com",
    displayName: "Ada",
    avatarUrl: null,
    role: "admin",
    status: "active",
    lastSeenAt: null,
    invitedAt: null,
    joinedAt: "2026-08-01T00:00:00.000Z",
    teamIds: [],
    ...over,
  } as WorkspaceMemberView;
}

function render(
  over: {
    loading?: boolean;
    tab?: "members" | "teams" | "access";
    members?: WorkspaceMemberView[];
    teams?: TeamView[];
    resources?: AccessMatrixResource[];
  } = {}
) {
  return renderToStaticMarkup(
    <MembersListPane
      loading={over.loading}
      tab={over.tab ?? "members"}
      onTabChange={() => {}}
      query=""
      onQueryChange={() => {}}
      selection={null}
      onSelect={() => {}}
      canManage
      members={over.members ?? []}
      teams={over.teams ?? []}
      resources={over.resources ?? []}
      invitations={[]}
      joinRequests={[]}
      currentUserId="u-1"
      onInvite={() => {}}
      onCreateTeam={() => {}}
      onRevokeInvitation={() => {}}
      onResolveJoinRequest={() => {}}
    />
  );
}

describe("MembersListPane loading state", () => {
  it("never claims the workspace is empty while the roster is in flight", () => {
    const html = render({ loading: true });
    expect(html).not.toContain("No members yet.");
  });

  it("ghosts rows from the shared kit instead", () => {
    const html = render({ loading: true });
    const ghosts = html.match(/data-slot="skeleton"/g) ?? [];
    expect(ghosts.length).toBeGreaterThan(0);
    expect((html.match(/animate-pulse/g) ?? []).length).toBe(ghosts.length);
  });

  it("announces the load rather than shimmering silently", () => {
    const html = render({ loading: true });
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
  });

  it("does the same for the teams and access tabs, which load separately", () => {
    expect(render({ loading: true, tab: "teams" })).not.toContain("No teams yet.");
    expect(render({ loading: true, tab: "access" })).not.toContain(
      "No knowledge bases or skills yet."
    );
  });
});

describe("MembersListPane loaded state", () => {
  it("still shows the genuine empty state once the query has answered", () => {
    expect(render()).toContain("No members yet.");
  });

  it("renders the roster and drops the ghosts", () => {
    const html = render({ members: [member()] });
    expect(html).toContain("Ada");
    expect(html).not.toContain('data-slot="skeleton"');
  });
});
