// @vitest-environment jsdom
/**
 * The Settings tab's runtime row and the ONE permission control (Ask / Auto / Full), over the real
 * adapters' descriptors and main's real reading of each level, so a descriptor change fails here.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import {
  REAL_DEFAULT_RUNTIME,
  REAL_DESCRIPTORS,
  realDescriptor,
} from "../lib/runtime-descriptors-harness";
import { agentView, disabled, postureLevel } from "./settings-agent-harness";
import {
  catalog,
  launchSelectionStub,
  type SelectionStubInput,
} from "../hooks/launch-selection-harness";

afterEach(cleanup);

const RUNTIME_ROW = "Runtime for agents you launch";

function withRuntime(runtime: string, over: SelectionStubInput = {}) {
  const selection = launchSelectionStub({
    runtimeSupported: true,
    runtimes: REAL_DESCRIPTORS,
    runtime,
    defaultRuntime: REAL_DEFAULT_RUNTIME,
    descriptor: realDescriptor(runtime || REAL_DEFAULT_RUNTIME),
    ...over,
  });
  return { selection, ...agentView({ selection }) };
}

/** The option labels behind a `SelectMenu`, as an operator would read them. */
function openMenu(trigger: HTMLElement): string[] {
  fireEvent.click(trigger);
  return screen.getAllByRole("menuitem").map((el) => el.textContent ?? "");
}

/** The Details rows, opened. */
function details(): string[] {
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  return Array.from(screen.getByLabelText("Permissions by runtime").querySelectorAll("li")).map((li) => li.textContent ?? "");
}

describe("a desktop with NO runtime key renders no runtime row at all", () => {
  it("omits the runtime row and Details rather than greying them — the older-desktop lane", () => {
    agentView();
    expect(screen.queryByLabelText(RUNTIME_ROW)).toBeNull();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
  });

  it("still renders the permission control", () => {
    agentView({ selection: launchSelectionStub({ level: "auto" }) });
    expect(postureLevel().textContent).toContain("Auto");
  });
});

describe("the runtime picker", () => {
  it("offers Default plus every registered adapter, by the PLATFORM's own label", () => {
    withRuntime("");
    expect(openMenu(screen.getByLabelText(RUNTIME_ROW))).toEqual(["Default", "Claude Code", "Codex", "Cursor"]);
  });

  it("writes the pick on the `runtime` key alone", () => {
    const { selection } = withRuntime("");
    fireEvent.click(screen.getByLabelText(RUNTIME_ROW));
    fireEvent.click(screen.getByRole("menuitem", { name: "Codex" }));
    expect(selection.update).toHaveBeenCalledWith({ runtime: "codex" });
  });

  it("goes inert while a posture write is in flight", () => {
    withRuntime("codex", { busy: true });
    expect(disabled(screen.getByLabelText(RUNTIME_ROW))).toBe(true);
    expect(disabled(postureLevel())).toBe(true);
  });
});

describe("ONE permission control, the same three levels on every runtime", () => {
  for (const runtime of ["claude", "codex", "cursor"]) {
    it(`${runtime}: Ask / Auto / Full — no runtime word, no sandbox row, no approval categories`, () => {
      const { container } = withRuntime(runtime, { level: "full" });
      expect(postureLevel().textContent).toContain("Full");
      expect(openMenu(postureLevel())).toEqual([expect.stringMatching(/^Ask/), expect.stringMatching(/^Auto/), expect.stringMatching(/^Full/)]);
      expect(screen.queryByLabelText("Tool use for agents you launch")).toBeNull();
      expect(screen.queryByText("Sandbox")).toBeNull();
      expect(container.textContent).not.toMatch(/sandbox_approval|mcp_elicitations/);
    });
  }

  it("writes the level alone", () => {
    const { selection } = withRuntime("codex", { level: "ask" });
    fireEvent.click(postureLevel());
    fireEvent.click(screen.getByRole("menuitem", { name: /^Full/ }));
    expect(selection.update).toHaveBeenCalledWith({ level: "full" });
  });
});

describe("Details: each runtime's own reading of its level, from main", () => {
  it("is collapsed until asked", () => {
    withRuntime("", { level: "full" });
    expect(screen.queryByLabelText("Permissions by runtime")).toBeNull();
  });

  it("Full names bypass, never/danger-full-access and run-everything, each in its own words", () => {
    withRuntime("", { level: "full" });
    expect(details()).toEqual([
      "Claude Code · Bypassbypass",
      "Codex · Full accessnever/danger-full-access",
      "Cursor · Run Everythingrun-everything",
    ]);
  });

  it("shows a migrated runtime's own, narrower level where it has one", () => {
    withRuntime("", { level: "full", byRuntime: { codex: "ask" } });
    expect(details()[1]).toBe("Codex · Ask for approvalon-request/workspace-write");
  });
});

describe("NO model row and NO reasoning-effort row, on any runtime", () => {
  const both = {
    claude: catalog("claude", [{ id: "claude-sonnet-5", label: "Sonnet 5", isDefault: true }]),
    codex: catalog("codex", [{ id: "gpt-6-astra", label: "GPT-6 Astra", isDefault: true, efforts: ["low", "high"] }]),
  };
  for (const runtime of ["claude", "codex", "cursor"]) {
    it(`${runtime}: neither row renders`, () => {
      const { container } = withRuntime(runtime, { catalogs: both });
      expect(screen.queryByLabelText("Model for agents you launch")).toBeNull();
      expect(screen.queryByLabelText("Reasoning effort for agents you launch")).toBeNull();
      expect(container.textContent).not.toMatch(/GPT-6 Astra|Sonnet 5/);
    });
  }
});

describe("what main refused, and what it could not fully honour", () => {
  it("says a REFUSED write out loud, in main's own words, and does not echo it into the row", () => {
    const { container } = withRuntime("codex", { level: "auto", rejected: ['"max" is not a permission level (ask, auto, full)'] });
    expect(container.textContent).toContain("is not a permission level");
    expect(postureLevel().textContent).toContain("Auto");
  });

  it("surfaces `needsReview` as a NOTE, never as a failure", () => {
    const { container } = withRuntime("codex", { review: ['Codex\'s stored setting "never/workspace-write" is now auto (on-request/workspace-write)'] });
    expect(container.textContent).toContain("is now auto");
  });
});
