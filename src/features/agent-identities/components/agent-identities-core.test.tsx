// @vitest-environment jsdom
/**
 * THE AGENTS PAGE — the three scope panels, and what a card is allowed to say.
 *
 * These are the properties that go quiet rather than loud when they break:
 *
 *  - **"PUBLIC" IS A LABEL OVER `workspace`.** Two vocabularies for one field,
 *    and the wire's word must never reach an operator (`../lib/visibility.ts`).
 *  - **AN EMPTY PANEL KEEPS ITS HEADER.** A section that vanished would make
 *    "you have no team identities" and "this workspace has no teams" the same
 *    picture.
 *  - **AN UNSET MODEL RENDERS NO CHIP, not "Default"** — a card states what a
 *    identity CARRIES (INVARIANTS §5, and `agent-models.ts ›
 *    agentModelShortLabel`, which returns `null` for exactly this).
 *
 * Every data hook is mocked: the assertions are about the grouping this page
 * computes, not about the transport underneath it (the channels core's rule).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AgentIdentity } from "../client/types";

const identities: AgentIdentity[] = [];
const mutate = vi.fn();
const mutateAsync = vi.fn(async () => ({}));

vi.mock("../hooks/use-agent-identities", () => ({
  useAgentIdentities: () => ({
    identities,
    loading: false,
    error: null,
    refetch: () => {},
  }),
}));
vi.mock("../hooks/use-agent-identity-writes", () => ({
  useAgentIdentityWrites: () => ({
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

const { AgentIdentitiesCore } = await import("./agent-identities-core");

function identity(over: Partial<AgentIdentity> = {}): AgentIdentity {
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

function renderPage(rows: AgentIdentity[]) {
  identities.length = 0;
  identities.push(...rows);
  return render(<AgentIdentitiesCore workspaceId="ws-1" workspaceSlug="acme-ab12cd" />);
}

afterEach(cleanup);

describe("the three panels", () => {
  it("stacks Private, Team and Public — in that order, always", () => {
    renderPage([]);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Private", "Team", "Public"]);
  });

  it("never shows the wire's word for the public scope", () => {
    renderPage([identity({ id: "t-3", name: "Docs bot", visibility: "workspace" })]);
    expect(document.body.textContent).not.toContain("workspace");
  });

  it("files each card under its own visibility", () => {
    renderPage([
      identity({ id: "t-1", name: "Mine", visibility: "private" }),
      identity({ id: "t-2", name: "Ours", visibility: "team", teamIds: ["team-1"] }),
      identity({ id: "t-3", name: "Everyone's", visibility: "workspace" }),
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
    renderPage([identity({ visibility: "private" })]);
    expect(screen.getByRole("region", { name: "Team" }).textContent).toContain(
      "No team identities yet."
    );
    expect(screen.getByRole("region", { name: "Public" }).textContent).toContain(
      "No public identities yet."
    );
  });

  it("drops a row whose scope this build does not know, rather than guessing", () => {
    // A newer server may mint a fourth scope. Filing it under "Private" would be
    // this page claiming something it does not know.
    renderPage([
      identity({ id: "t-9", name: "From the future", visibility: "org" as never }),
    ]);
    expect(screen.queryByText("From the future")).toBeNull();
  });
});

describe("what a card says", () => {
  it("shows the name, the description line and the model chip", () => {
    renderPage([
      identity({ description: "Runs the checklist", model: "claude-opus-5" }),
    ]);
    const card = screen.getByRole("button", { name: /Release captain/ });
    expect(card.textContent).toContain("Release captain");
    expect(card.textContent).toContain("Runs the checklist");
    expect(card.textContent).toContain("Opus");
  });

  it("renders NO chip for an unset model — absence is not \"Default\" here", () => {
    renderPage([identity({ model: null })]);
    expect(screen.queryByText("Default")).toBeNull();
  });
});

describe("the create affordance", () => {
  it("is ONE page-level button, not a plus per section", () => {
    renderPage([]);
    expect(screen.getAllByRole("button", { name: "Agent Identity" })).toHaveLength(1);
  });

  // ⚠ `await`ed: `ModalShell` mounts a FRAME after `open` flips (it animates in).
  it("opens the editor in CREATE mode — no identity preloaded", async () => {
    renderPage([identity()]);
    fireEvent.click(screen.getByRole("button", { name: "Agent Identity" }));
    expect(await screen.findByRole("dialog", { name: "New agent identity" })).toBeTruthy();
  });

  it("opens the editor on a CARD, carrying that identity", async () => {
    renderPage([identity({ name: "Release captain" })]);
    fireEvent.click(screen.getByRole("button", { name: /Release captain/ }));
    const dialog = await screen.findByRole("dialog", { name: "Edit agent identity" });
    expect(dialog.querySelector<HTMLInputElement>("#agent-identity-name")?.value).toBe(
      "Release captain"
    );
  });
});

describe("what this page deliberately leaves out", () => {
  it("offers no launch control — launch-time selection is a later phase", () => {
    renderPage([identity()]);
    expect(screen.queryByText(/launch/i)).toBeNull();
    expect(screen.queryByText(/run/i)).toBeNull();
  });
});
