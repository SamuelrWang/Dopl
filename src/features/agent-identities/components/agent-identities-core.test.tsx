// @vitest-environment jsdom
/**
 * THE AGENTS PAGE — the three scope panels, and what a card is allowed to say.
 *
 * These are the properties that go quiet rather than loud when they break:
 *
 *  - **"PUBLIC" IS A LABEL OVER `workspace`.** Two vocabularies for one field,
 *    and the wire's word must never reach an operator (`../lib/visibility.ts`).
 *  - **AN EMPTY PANEL KEEPS ITS HEADER.** A section that vanished would make
 *    "you have no team templates" and "this workspace has no teams" the same
 *    picture.
 *  - **AN UNSET MODEL RENDERS NO CHIP, not "Default"** — a card states what a
 *    template CARRIES (INVARIANTS §5, and `agent-models.ts ›
 *    agentModelShortLabel`, which returns `null` for exactly this).
 *
 * Every data hook is mocked: the assertions are about the grouping this page
 * computes, not about the transport underneath it (the channels core's rule).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AgentTemplate } from "../client/types";

const templates: AgentTemplate[] = [];
const mutate = vi.fn();
const mutateAsync = vi.fn(async () => ({}));

vi.mock("../hooks/use-agent-templates", () => ({
  useAgentTemplates: () => ({
    templates,
    loading: false,
    error: null,
    refetch: () => {},
  }),
}));
vi.mock("../hooks/use-agent-template-writes", () => ({
  useAgentTemplateWrites: () => ({
    create: { mutate, mutateAsync, pending: false, error: null },
    update: { mutate, mutateAsync, pending: false, error: null },
    remove: { mutate, mutateAsync, pending: false, error: null },
  }),
}));
vi.mock("@/features/members/hooks/use-teams", () => ({
  useTeams: () => ({ teams: [], loading: false, error: null, refresh: () => {} }),
}));
vi.mock("@/features/knowledge/client/hooks", () => ({
  useKnowledgeBaseList: () => ({ data: { bases: [] }, error: null, status: "success", refetch: () => {} }),
}));

const { AgentTemplatesCore } = await import("./agent-templates-core");

function template(over: Partial<AgentTemplate> = {}): AgentTemplate {
  return {
    id: "tpl-1",
    workspaceId: "ws-1",
    name: "Release captain",
    description: null,
    instructions: null,
    model: null,
    fields: [],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [],
    createdBy: "user-1",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

function renderPage(rows: AgentTemplate[]) {
  templates.length = 0;
  templates.push(...rows);
  return render(<AgentTemplatesCore workspaceId="ws-1" workspaceSlug="acme-ab12cd" />);
}

afterEach(cleanup);

describe("the three panels", () => {
  it("stacks Private, Team and Public — in that order, always", () => {
    renderPage([]);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Private", "Team", "Public"]);
  });

  it("never shows the wire's word for the public scope", () => {
    renderPage([template({ id: "t-3", name: "Docs bot", visibility: "workspace" })]);
    expect(document.body.textContent).not.toContain("workspace");
  });

  it("files each card under its own visibility", () => {
    renderPage([
      template({ id: "t-1", name: "Mine", visibility: "private" }),
      template({ id: "t-2", name: "Ours", visibility: "team", teamIds: ["team-1"] }),
      template({ id: "t-3", name: "Everyone's", visibility: "workspace" }),
    ]);
    for (const [label, name] of [
      ["Private", "Mine"],
      ["Team", "Ours"],
      ["Public", "Everyone's"],
    ]) {
      const section = screen.getByRole("region", { name: label });
      expect(section.textContent).toContain(name);
    }
  });

  it("keeps an empty panel's header and says ONE quiet line", () => {
    renderPage([template({ visibility: "private" })]);
    expect(screen.getByRole("region", { name: "Team" }).textContent).toContain(
      "No team templates yet."
    );
    expect(screen.getByRole("region", { name: "Public" }).textContent).toContain(
      "No public templates yet."
    );
  });

  it("drops a row whose scope this build does not know, rather than guessing", () => {
    // A newer server may mint a fourth scope. Filing it under "Private" would be
    // this page claiming something it does not know.
    renderPage([
      template({ id: "t-9", name: "From the future", visibility: "org" as never }),
    ]);
    expect(screen.queryByText("From the future")).toBeNull();
  });
});

describe("what a card says", () => {
  it("shows the name, the description line and the model chip", () => {
    renderPage([
      template({ description: "Runs the checklist", model: "claude-opus-5" }),
    ]);
    const card = screen.getByRole("button", { name: /Release captain/ });
    expect(card.textContent).toContain("Release captain");
    expect(card.textContent).toContain("Runs the checklist");
    expect(card.textContent).toContain("Opus");
  });

  it("renders NO chip for an unset model — absence is not \"Default\" here", () => {
    renderPage([template({ model: null })]);
    expect(screen.queryByText("Default")).toBeNull();
  });
});

describe("the create affordance", () => {
  it("is ONE page-level button, not a plus per section", () => {
    renderPage([]);
    expect(screen.getAllByRole("button", { name: "New template" })).toHaveLength(1);
  });

  // ⚠ `await`ed: `ModalShell` mounts a FRAME after `open` flips (it animates in).
  it("opens the editor in CREATE mode — no template preloaded", async () => {
    renderPage([template()]);
    fireEvent.click(screen.getByRole("button", { name: "New template" }));
    expect(await screen.findByRole("dialog", { name: "New template" })).toBeTruthy();
  });

  it("opens the editor on a CARD, carrying that template", async () => {
    renderPage([template({ name: "Release captain" })]);
    fireEvent.click(screen.getByRole("button", { name: /Release captain/ }));
    const dialog = await screen.findByRole("dialog", { name: "Edit template" });
    expect(dialog.querySelector<HTMLInputElement>("#agent-template-name")?.value).toBe(
      "Release captain"
    );
  });
});

describe("what this page deliberately leaves out", () => {
  it("offers no launch control — launch-time selection is a later phase", () => {
    renderPage([template()]);
    expect(screen.queryByText(/launch/i)).toBeNull();
    expect(screen.queryByText(/run/i)).toBeNull();
  });
});
