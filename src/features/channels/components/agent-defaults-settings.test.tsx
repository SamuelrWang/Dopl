// @vitest-environment jsdom
/**
 * THE PROFILE POPUP'S DEFAULTS PANE — its copy under the minimal-copy ruling (P6-25): the scope
 * clause and nothing else, and no explainer sentence in place of rows without the bridge.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { AgentDefaultsSettings } from "./agent-defaults-settings";
import { REAL_DEFAULT_RUNTIME, REAL_DESCRIPTORS } from "../lib/runtime-descriptors-harness";

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

describe("AgentDefaultsSettings copy", () => {
  it("states the pane's scope in one clause", async () => {
    (window as { dopl?: unknown }).dopl = {
      apiRequest: vi.fn(),
      channels: {
        getAgentDefaults: vi.fn().mockResolvedValue({
          v: 2,
          runtime: "",
          messages: "ask",
          byRuntime: {},
          agentChain: false,
          runtimes: REAL_DESCRIPTORS,
          defaultRuntime: REAL_DEFAULT_RUNTIME,
          connected: [],
        }),
        setAgentDefaults: vi.fn().mockResolvedValue({ ok: true }),
      },
    };
    await act(async () => {
      render(<AgentDefaultsSettings />);
    });
    expect(screen.getByText("What a new channel's agents start on.")).toBeTruthy();
    expect(screen.queryByText(/already have keep their own settings/)).toBeNull();
  });

  it("renders its title and no explainer without the bridge", () => {
    const { container } = render(<AgentDefaultsSettings />);
    expect(screen.getByText("Agents")).toBeTruthy();
    expect(container.querySelector("p")).toBeNull();
  });
});
