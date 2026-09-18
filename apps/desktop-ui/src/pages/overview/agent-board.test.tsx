import { cleanup, render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { OverviewAgentRow } from "@/features/workspaces/types";
import { AgentBoardPanel } from "./agent-board";

/**
 * THE WORKSPACE OVERVIEW'S LIVE AGENT BOARD (wave 8).
 *
 * What is pinned here is the RULING, not the layout:
 *  - **R-25**: every member's LIVE agent is listed (an ENDED one never reaches
 *    the payload), and a PEER's row is READ-ONLY — state, not a destination;
 *  - **R-29's privacy half**: the card carries no model, tool label, token or
 *    context figure, and a peer is marked without being named;
 *  - an empty board costs NO panel at all.
 */

const CH = "33333333-4444-5555-6666-777777777777";
const SEGMENT = "acme-ab12";

const agent = (over: Partial<OverviewAgentRow> = {}): OverviewAgentRow => ({
  id: "s-1",
  channelId: CH,
  channelName: "Build",
  name: "Scout",
  state: "working",
  detail: "thinking",
  threadTitle: "Ship the migration",
  threadId: "t-1",
  mine: true,
  updatedAt: new Date().toISOString(),
  ...over,
});

function renderBoard(rows: OverviewAgentRow[]) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <AgentBoardPanel rows={rows} segment={SEGMENT} /> },
      { path: `/${SEGMENT}/channels/:channelId`, element: <div>CHANNEL</div> },
    ],
    { initialEntries: ["/"] }
  );
  render(<RouterProvider router={router} />);
}

afterEach(cleanup);

describe("AgentBoardPanel", () => {
  it("renders nothing at all when no agent is running", () => {
    renderBoard([]);
    expect(screen.queryByRole("heading", { name: "Active agents" })).toBeNull();
  });

  it("lists everyone's live agents, one lane per channel", () => {
    renderBoard([
      agent(),
      agent({ id: "s-2", name: "Nomad", mine: false }),
      agent({
        id: "s-3",
        channelId: "44444444-4444-5555-6666-777777777777",
        channelName: "Design",
        name: "Pilot",
      }),
    ]);
    expect(screen.getByRole("heading", { name: "Active agents" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Build" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Design" })).toBeDefined();
    expect(screen.getByText("Scout")).toBeDefined();
    expect(screen.getByText("Nomad")).toBeDefined();
  });

  it("makes MY row a button and a PEER's row read-only (R-25)", () => {
    renderBoard([agent(), agent({ id: "s-2", name: "Nomad", mine: false })]);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain("Scout");
    // The peer is MARKED, never named.
    expect(screen.getByText("Peer")).toBeDefined();
  });

  it("carries no telemetry — the card is a name, a state and a thread", () => {
    renderBoard([agent({ detail: "tool" })]);
    const card = screen.getByRole("button");
    expect(card.textContent).toContain("Running a tool");
    for (const leak of ["opus", "tokens", "context", "%"]) {
      expect(card.textContent?.toLowerCase()).not.toContain(leak);
    }
  });

  it("prints the plain state for a situation key it does not recognise", () => {
    renderBoard([agent({ detail: "seventh_key" })]);
    expect(screen.getByText("working")).toBeDefined();
  });
});
