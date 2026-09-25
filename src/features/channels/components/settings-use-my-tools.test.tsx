// @vitest-environment jsdom
/**
 * "USE MY TOOLS" (Samuel, 2026-09-25): a row in a SHARED channel's Agent Settings, and nothing in a
 * private one (a private channel always has the operator's tools, so a control there sets nothing).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { agentView, copy, disabled } from "./settings-agent-harness";

afterEach(cleanup);

const row = (on = false, busy = false) => ({ on, busy, onToggle: vi.fn() });
const control = () => screen.getByLabelText("Whether agents here may use your own tools on turns you start");

describe("Use my tools", () => {
  it("renders in a shared channel, label + control only", () => {
    agentView({ memberCount: 2, useMyTools: row(true) });
    expect(control().textContent).toContain("On");
  });

  it("is absent in a private channel and without the desktop bridge", () => {
    expect(copy({ memberCount: 1, useMyTools: row() })).not.toContain("Use my tools");
    expect(copy({ memberCount: 3, useMyTools: null })).not.toContain("Use my tools");
  });

  it("writes the pick, and goes inert while a write is in flight", () => {
    const state = row(false);
    agentView({ memberCount: 2, useMyTools: state });
    fireEvent.click(control());
    fireEvent.click(screen.getByRole("menuitem", { name: /^On/ }));
    expect(state.onToggle).toHaveBeenCalledWith(true);
    cleanup();
    agentView({ memberCount: 2, useMyTools: row(false, true) });
    expect(disabled(control())).toBe(true);
  });
});
