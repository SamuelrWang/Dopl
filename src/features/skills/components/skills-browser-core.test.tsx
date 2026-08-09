import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Skill } from "@/features/skills/types";

vi.mock("./skill-view", () => ({
  SkillView: () => null,
}));

const { SkillsBrowserCore } = await import("./skills-browser-core");

/**
 * P0-6, the first dead control: the "New skill" `+` was hardcoded `disabled`
 * with a tooltip promising authoring "in the next milestone", which meant a
 * user could not create a skill in the product AT ALL — the only route was an
 * agent over MCP. The affordance is now real (`CreateSkillDialog` →
 * `POST /api/skills` → the existing editor), so what this file guards is that
 * it never regresses to a decoration.
 */

function skill(over: Partial<Skill> = {}): Skill {
  return {
    id: "s-1",
    workspaceId: "w-1",
    slug: "release-note",
    name: "Draft a release note",
    description: "Turns a diff into a release note.",
    whenToUse: "When shipping.",
    whenNotToUse: null,
    status: "active",
    visibility: "private",
    accessMode: "workspace",
    agentWriteEnabled: true,
    folder: null,
    connectors: [],
    createdBy: "u-me",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  } as Skill;
}

function render(skills: Skill[]) {
  return renderToStaticMarkup(
    <SkillsBrowserCore
      workspaceSlug="acme"
      workspaceId="w-1"
      currentUserId="u-me"
      isAdmin
      skills={skills}
      onListChanged={() => {}}
    />
  );
}

describe("skills browser — the New skill control", () => {
  it("is live, not a disabled decoration", () => {
    const html = render([skill()]);
    const button = html.match(/<button[^>]*aria-label="New skill"[^>]*>/)?.[0];
    expect(button).toBeDefined();
    expect(button).not.toContain("disabled");
    expect(button).not.toContain("cursor-not-allowed");
  });

  it("no longer promises authoring in a future milestone", () => {
    expect(render([skill()])).not.toContain("next milestone");
  });

  it("points an empty workspace at the control instead of only at MCP", () => {
    const html = render([]);
    expect(html).toContain("+");
    expect(html).toContain("dopl_skill");
  });
});

describe("skills browser — list rendering", () => {
  it("groups by folder with unfiled last", () => {
    const html = render([
      skill({ id: "s-1", name: "Unfiled one", folder: null }),
      skill({ id: "s-2", slug: "b", name: "Filed one", folder: "Release" }),
    ]);
    expect(html.indexOf("Release")).toBeLessThan(html.indexOf("Unfiled"));
  });

  it("counts every live skill beside the title", () => {
    const html = render([skill(), skill({ id: "s-2", slug: "b" })]);
    expect(html).toContain(">2<");
  });
});
