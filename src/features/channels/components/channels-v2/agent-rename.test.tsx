// @vitest-environment jsdom
/**
 * RENAMING ONE AGENT, IN PLACE (2026-08-25, Samuel's ruling).
 *
 * ⚠ WHAT IS PINNED HERE IS THAT THE CARD PAINTS **MAIN'S** ANSWER, never its own ask. The
 * machine may refuse a name (too long, or carrying control / zero-width / bidi characters) and
 * the field must revert — a card left showing a name nothing is holding is the failure this
 * whole shape exists to avoid, and it is invisible until a restart.
 *
 * ⚠ AND THAT AN EMPTY NAME CLEARS rather than storing a blank: the operator goes back to the
 * canonical `Agent #<id>`, which is what the card falls back to.
 *
 * ⚠ AND THAT THERE IS NO PENCIL WITHOUT A HANDLER. Feature detection, the rule every bridge
 * affordance on this surface follows: a control that cannot save is worse than an absent one.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentName } from "./agent-rename";

const rename = vi.fn();

/** ⚠ `apiRequest` IS THE SPA MARKER (`spa-bridge.ts › getSpaBridge`) — a `window.dopl` without
 *  it is the legacy wrapper's partial object and reads as NO bridge, so every fixture here
 *  carries one or the detection this file is about would not be under test at all. */
function withBridge(sessions: unknown) {
  (window as unknown as { dopl?: unknown }).dopl = sessions
    ? { apiRequest: () => Promise.resolve(null), sessions }
    : undefined;
}

afterEach(() => {
  cleanup();
  rename.mockReset();
  withBridge(null);
});

describe("the agent card's inline rename", () => {
  it("offers no pencil without a bridge handler, and none without an id", () => {
    withBridge({});
    render(<AgentName agentId="a1b2c3d4" name="Agent #a1b2c3d4" />);
    expect(screen.queryByRole("button", { name: /^Rename/ })).toBeNull();

    cleanup();
    // A main old enough to omit `agentId` has nothing to key a name to.
    withBridge({ rename });
    render(<AgentName agentId={null} name="flint" />);
    expect(screen.queryByRole("button", { name: /^Rename/ })).toBeNull();
  });

  it("saves on Enter and paints the value MAIN stored, not the one typed", async () => {
    // Main trims and collapses; the card must show ITS answer, or the two drift silently.
    rename.mockResolvedValue({ ok: true, displayName: "Research bot" });
    withBridge({ rename });
    render(<AgentName agentId="a1b2c3d4" name="Agent #a1b2c3d4" />);

    fireEvent.click(screen.getByRole("button", { name: "Rename Agent #a1b2c3d4" }));
    const field = screen.getByLabelText("Agent name");
    fireEvent.change(field, { target: { value: "  Research   bot  " } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() =>
      expect(rename).toHaveBeenCalledWith("a1b2c3d4", "Research   bot")
    );
    expect(await screen.findByText("Research bot")).toBeTruthy();
  });

  it("REVERTS a refusal — the card never shows a name nothing is holding", async () => {
    rename.mockResolvedValue({ ok: false, reason: "bad-name" });
    withBridge({ rename });
    render(<AgentName agentId="a1b2c3d4" name="Agent #a1b2c3d4" />);

    fireEvent.click(screen.getByRole("button", { name: "Rename Agent #a1b2c3d4" }));
    fireEvent.change(screen.getByLabelText("Agent name"), { target: { value: "x".repeat(99) } });
    fireEvent.keyDown(screen.getByLabelText("Agent name"), { key: "Enter" });

    await waitFor(() => expect(rename).toHaveBeenCalled());
    expect(await screen.findByText("Agent #a1b2c3d4")).toBeTruthy();
  });

  it("saves on blur too — clicking away keeps what was typed", async () => {
    rename.mockResolvedValue({ ok: true, displayName: "Reviewer" });
    withBridge({ rename });
    render(<AgentName agentId="a1b2c3d4" name="Agent #a1b2c3d4" />);

    fireEvent.click(screen.getByRole("button", { name: "Rename Agent #a1b2c3d4" }));
    fireEvent.change(screen.getByLabelText("Agent name"), { target: { value: "Reviewer" } });
    fireEvent.blur(screen.getByLabelText("Agent name"));

    await waitFor(() => expect(rename).toHaveBeenCalledWith("a1b2c3d4", "Reviewer"));
  });

  it("Escape cancels, and the blur it causes does NOT save", async () => {
    withBridge({ rename });
    render(<AgentName agentId="a1b2c3d4" name="Agent #a1b2c3d4" />);

    fireEvent.click(screen.getByRole("button", { name: "Rename Agent #a1b2c3d4" }));
    const field = screen.getByLabelText("Agent name");
    fireEvent.change(field, { target: { value: "Discard me" } });
    fireEvent.keyDown(field, { key: "Escape" });
    fireEvent.blur(field);

    expect(rename).not.toHaveBeenCalled();
    expect(screen.getByText("Agent #a1b2c3d4")).toBeTruthy();
  });

  it("an EMPTY name clears rather than storing a blank", async () => {
    rename.mockResolvedValue({ ok: true, displayName: null });
    withBridge({ rename });
    render(<AgentName agentId="a1b2c3d4" name="Research bot" />);

    fireEvent.click(screen.getByRole("button", { name: "Rename Research bot" }));
    fireEvent.change(screen.getByLabelText("Agent name"), { target: { value: "  " } });
    fireEvent.keyDown(screen.getByLabelText("Agent name"), { key: "Enter" });

    await waitFor(() => expect(rename).toHaveBeenCalledWith("a1b2c3d4", ""));
    // `displayName: null` means "no name" — the card falls back to what it was handed.
    expect(await screen.findByText("Research bot")).toBeTruthy();
  });

  it("does not write when nothing changed", () => {
    withBridge({ rename });
    render(<AgentName agentId="a1b2c3d4" name="Agent #a1b2c3d4" />);

    fireEvent.click(screen.getByRole("button", { name: "Rename Agent #a1b2c3d4" }));
    fireEvent.keyDown(screen.getByLabelText("Agent name"), { key: "Enter" });

    // ⚠ Sending the unchanged title would store `Agent #<id>` AS a name — the address
    // promoted into a display string, which nothing could then tell apart from a real rename.
    expect(rename).not.toHaveBeenCalled();
  });
});
