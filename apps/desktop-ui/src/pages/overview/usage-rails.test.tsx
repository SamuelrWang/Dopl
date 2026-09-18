import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceUsageBreakdown } from "@/features/workspaces/types";
import { UsageRails } from "./usage-rails";

/**
 * THE WORKSPACE OVERVIEW'S BREAKDOWN RAILS (wave 8, R-29(b)).
 *
 * Pinned: the three questions the ruling named (by channel, by person, by
 * tool), the guest mark, and the CLIPPED note — a scan at its ceiling says so
 * beside the sections it clipped (§9), never in a footer and never silently.
 */

const usage = (over: Partial<WorkspaceUsageBreakdown> = {}) =>
  ({
    since: "2026-09-01T00:00:00.000Z",
    channels: [
      { channelId: "c-1", name: "Build", credits: 40, messages: 12 },
      { channelId: "c-2", name: "", credits: 0, messages: 90 },
    ],
    people: [
      { userId: "u-1", name: "Ada", role: "member", credits: 30 },
      { userId: "u-2", name: "", role: "guest", credits: 10 },
    ],
    tools: [{ tool: "dopl_kb", op: "read_file", calls: 7 }],
    scanned: 120,
    truncated: false,
    ...over,
  }) satisfies WorkspaceUsageBreakdown;

afterEach(cleanup);

describe("UsageRails", () => {
  it("draws the three rails the ruling named, plus messages by channel", () => {
    render(<UsageRails usage={usage()} />);
    for (const title of [
      "Credits by channel",
      "Messages by channel",
      "Credit usage by person",
      "Top MCP tools",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeDefined();
    }
    expect(screen.getByText("dopl_kb · read_file")).toBeDefined();
  });

  it("marks guests and names an unresolved member rather than printing nothing", () => {
    render(<UsageRails usage={usage()} />);
    expect(screen.getByText("Guest")).toBeDefined();
    expect(screen.getByText("1 guest · 10")).toBeDefined();
    expect(screen.getAllByText("Unknown member")).toHaveLength(1);
    // A channel with no name of its own still needs a rail label.
    expect(screen.getAllByText("Untitled channel")).toHaveLength(2);
  });

  it("says so when a scan came back at its ceiling, with the denominator", () => {
    render(<UsageRails usage={usage({ truncated: true })} />);
    expect(screen.getByText("Rails cover the newest 120 rows.")).toBeDefined();
  });

  it("ghosts rather than drawing zeroes before the payload lands", () => {
    render(<UsageRails usage={undefined} />);
    expect(screen.getByRole("heading", { name: "All channels" })).toBeDefined();
    expect(screen.queryByText("Nothing yet.")).toBeNull();
  });
});
