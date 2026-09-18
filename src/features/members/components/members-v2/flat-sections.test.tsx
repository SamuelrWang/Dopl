/**
 * 🔒 **THE MEMBERS CONSOLE'S SECTIONS ARE FLAT (Samuel's ruling R-39,
 * 2026-09-17).** Five files here mounted `SectionBox` — a header STRIP over a
 * concave inset body that supplied the FRAME, the FILL and the rows' `px-3`
 * gutter in one component. `SectionPanel` supplies its own `p-3` and nothing
 * else, so every one of those swaps had to land the ground AND drop the inner
 * inset; miss the first and the pane loses its wells, miss the second and every
 * row steps in past its own heading.
 *
 * ⚠ A MARKUP READ, because jsdom loads no stylesheet: the ground is a class
 * STRING, and a rendered colour assertion would report the same nothing either
 * way.
 */

import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SECTION_PANEL_GROUND } from "@/shared/ui/section-panel";
import type { TeamView } from "@/features/teams/types";
import type { EffectiveAccessRow } from "@/features/teams/effective-access";
import type { WorkspaceMemberView } from "../../types";
import { MemberFacts } from "./member-facts";
import { AccessTab } from "./tab-access";
import { SettingsTab } from "./tab-settings";
import { visibilityFor } from "./visibility";

const ADMIN = { userId: "u-admin", role: "admin" as const };

const MEMBER: WorkspaceMemberView = {
  workspaceId: "w1",
  userId: "u-target",
  role: "member",
  status: "active",
  joinedAt: "2026-01-01T00:00:00.000Z",
  invitedBy: null,
  invitedAt: null,
  lastSeenAt: null,
  email: "target@example.com",
  displayName: "Target",
  avatarUrl: null,
  teams: [],
};

const TEAM: TeamView = {
  id: "t1",
  workspaceId: "w1",
  name: "Design",
  description: null,
  color: null,
  icon: null,
  createdBy: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  memberCount: 1,
  memberIds: ["u-target"],
  grants: [],
};

const ACCESS: EffectiveAccessRow[] = [
  {
    resourceType: "knowledge_base",
    resourceId: "kb1",
    resourceName: "Product specs",
    level: "edit",
    viaTeam: null,
  },
];

const visibility = visibilityFor(ADMIN, MEMBER);
const paint = (node: ReactElement) => renderToStaticMarkup(node);

/** ⚠ THUNKS, not elements: an array of JSX would want React keys it has no
 *  list to be in. */
const PANES: [string, () => ReactElement][] = [
  [
    "member-facts.tsx",
    () => (
      <MemberFacts
        member={MEMBER}
        teams={[TEAM]}
        visibility={visibility}
        busy={false}
        onJoinTeam={() => {}}
        onLeaveTeam={() => {}}
      />
    ),
  ],
  [
    "tab-access.tsx",
    () => (
      <AccessTab
        member={MEMBER}
        rows={ACCESS}
        loading={false}
        error={null}
        onRetry={() => {}}
        visibility={visibility}
      />
    ),
  ],
  [
    "tab-settings.tsx",
    () => (
      <SettingsTab
        member={MEMBER}
        visibility={visibility}
        busy={false}
        onRoleChange={() => {}}
        onRemove={() => {}}
      />
    ),
  ],
];

describe.each(PANES)("%s", (_file, pane) => {
  const markup = paint(pane());

  it("grounds every section as a flat well", () => {
    expect(markup).toContain("data-section-panel");
    for (const token of SECTION_PANEL_GROUND.split(" ")) {
      expect(markup).toContain(token);
    }
  });

  it("wears no part of the concave box it replaced", () => {
    expect(markup).not.toContain("bg-bg-inset");
    expect(markup).not.toContain("shadow-[inset_");
    // `SectionBox`'s frame and its `--card-surface-subtle` header strip.
    expect(markup).not.toContain("border-border-strong");
    expect(markup).not.toContain("bg-card-surface-subtle");
  });

  it("does not nest a second gutter inside the panel's own padding", () => {
    // ⚠ THE ROW GUTTER IS THE REGRESSION THIS FILE EXISTS FOR. `SectionBox`'s
    // body was edge-to-edge, so its rows and bodies carried `px-3 py-2(.5)`;
    // inside a `p-3` panel that is 24px of inset before the first character.
    // ⚠ The ROW recipe, not the string `px-3` — a pill or a button inside a
    // row has its own horizontal padding and always did.
    expect(markup).not.toContain("px-3 py-2");
  });
});

describe("the counts moved to the caption slot", () => {
  it("still renders them, and beside no header strip", () => {
    // `SectionBox`'s `meta` had no `SectionPanel` counterpart; a fact ABOUT a
    // section is what `caption` is for.
    const markup = paint(
      <AccessTab
        member={MEMBER}
        rows={ACCESS}
        loading={false}
        error={null}
        onRetry={() => {}}
        visibility={visibility}
      />
    );
    expect(markup).toContain("Can edit");
    expect(markup).toContain(">1<");
  });
});
