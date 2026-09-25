// @vitest-environment jsdom
// The durable launch posture, the only permission posture the desktop stores (`main/channel-prefs.js`),
// and the two permission axes compared across both trees.

import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import {
  agentView,
  copy,
  desktopMainFilesContaining,
  desktopSource,
  disabled,
  postureSends,
  postureTools,
} from "./settings-agent-harness";
import { launchSelectionStub } from "../hooks/launch-selection-harness";
import { SETTINGS_HELP } from "./settings-help";
import { readSource } from "@/shared/testing/source-text";

afterEach(cleanup);

const CHANNEL_PREFS = desktopSource("channel-prefs.js");

describe("the LAUNCH POSTURE renders with its current values, and changes on selection", () => {
  it("shows both axes' current values without opening anything", () => {
    agentView({
      selection: launchSelectionStub({
        runtime: "",
        byRuntime: { "": { tools: "bypass" } },
        messages: "auto_both",
      }),
    });
    expect(postureTools().textContent).toContain("Bypass");
    expect(postureSends().textContent).toContain("Automatic");
  });

  it("writes the picked mode back on the axis it belongs to", () => {
    const selection = launchSelectionStub();
    agentView({ selection });
    fireEvent.click(postureTools());
    fireEvent.click(screen.getByRole("menuitem", { name: /^Bypass/ }));
    // The `tools` key alone: main's write is own-key, and restating a field would re-stamp one nobody moved.
    expect(selection.update).toHaveBeenCalledWith({ tools: "bypass" });
  });

  it("goes inert while a posture write is in flight", () => {
    agentView({ selection: launchSelectionStub({ busy: true }) });
    expect(disabled(postureTools())).toBe(true);
    expect(disabled(postureSends())).toBe(true);
  });

  it("says WHICH LAUNCHES it governs, and never claims to be every session", () => {
    // The group headings are gone; each row's scope lives in its `SETTINGS_HELP` popover.
    const text = copy();
    expect(text).not.toContain("When you launch an agent");
    expect(text).not.toContain("For every session on this channel");
    expect(SETTINGS_HELP["Tool use"].body).toContain("an agent you launch here");
    // No Claude-only option list under a row whose words are the runtime's; no help for a Model row.
    expect(SETTINGS_HELP["Tool use"].options).toBeUndefined();
    expect("Model" in SETTINGS_HELP).toBe(false);
    // The deleted single-use arm's heading is what a reader would reach for to re-add a fuse (F-233).
    expect(text).not.toContain("For the next request you allow");
    expect(text).not.toMatch(/Permissions[^.]*\balways\b/i);
  });

  it("is the ONLY permission posture the desktop stores — the arm is gone", () => {
    // H2: a stored posture only reaches a launch a human is approving; one key, the arm's stay gone.
    expect(CHANNEL_PREFS).toContain("const POSTURE_KEY = 'channelLaunchPosture'");
    expect(CHANNEL_PREFS).not.toMatch(/const PRESETS_KEY\s*=/);
    expect(CHANNEL_PREFS).not.toMatch(/const ARM_TTL_MS\s*=/);
    expect(CHANNEL_PREFS).not.toMatch(/^function (arm|consume|clear)PermissionPreset/m);
    // Appliers are counted, not named (F-237), over both spellings: the button lane and the orchestrator
    // lane, whose approval is a local, default-off toggle. A third needs an argument of this shape.
    // `channel-dir-ipc.js` is excluded: it only discloses the stored posture to the settings UI.
    const DISCLOSURE_ONLY = "channel-dir-ipc.js";
    const readers = [
      ...desktopMainFilesContaining("channelPrefs.launchStartModes("),
      ...desktopMainFilesContaining("channelPrefs.getLaunchPosture("),
      ...desktopMainFilesContaining("channelPrefs.launchPostureFor("),
    ].filter((f) => f !== DISCLOSURE_ONLY);
    expect([...new Set(readers)].sort()).toEqual([
      "launch-directive-spawn.js",
      "session-launch-op.js",
    ]);
  });

  it("drops the whole posture subsection, heading included, with no bridge", () => {
    const text = copy({ selection: launchSelectionStub({ bridge: null }) });
    expect(text).not.toContain("When you launch an agent");
    expect(screen.queryByText("Permissions")).toBeNull();
    expect(screen.queryByText("Sends")).toBeNull();
    // The durable control is not desktop-gated. A `SelectMenu`: its options exist only while open.
    expect(
      screen.getByLabelText("Tool access for agents on this channel")
    ).toBeTruthy();
  });
});

// `TOOL_MODES`/`MESSAGE_MODES` are re-typed in desktop main and the SPA. Main coerces an unknown mode
// fail-closed, so a web mode it dropped reads as saved and applies as the most restrictive. Declaring
// files are found by scanning `main/`, so a new copy joins the comparison.
describe("the two permission axes agree across both trees", () => {
  /** The string members of `const NAME = [...]`: either quote, TS `as const` or plain JS. */
  const modes = (source: string, name: string): string[] => {
    const m = new RegExp(`const\\s+${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(source);
    if (!m) throw new Error(`no \`const ${name} = [ … ]\` in source`);
    return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
  };

  // Per axis (Axis A in each adapter's `tools.js`, Axis B in the gate); the needle is the literal
  // declaration, so a file that only reads a list is not in it.
  const declaringFiles = (name: string) => desktopMainFilesContaining(`const ${name} = [`);
  // The web half is what the SPA offers: the option lists, in order.
  const WEB_MODULE = "src/features/channels/components/permission-preset-row.tsx";
  const web = readSource(resolve(process.cwd(), WEB_MODULE));
  const offered = (name: string): string[] => {
    const list = name === "TOOL_MODES" ? "TOOL_OPTIONS" : "MESSAGE_OPTIONS";
    const m = new RegExp(`export const ${list}[^=]*=\\s*\\[([\\s\\S]*?)\\n\\];`).exec(web);
    if (!m) throw new Error(`no \`${list}\` in ${WEB_MODULE}`);
    return [...m[1].matchAll(/value: "([^"]+)"/g)].map((x) => x[1]);
  };

  // Axis A is declared by the adapter (`descriptor.toolMode.options`); `session-profiles.js` reads it.
  const ADAPTER = "runtime/claude/index.js";
  const declaredToolModes = (): string[] => {
    const block = /options: \[([\s\S]*?)\n {4}\]/.exec(desktopSource(ADAPTER));
    if (!block) throw new Error(`no \`toolMode.options\` array in ${ADAPTER}`);
    return [...block[1].matchAll(/\{ value: '([^']+)'/g)].map((x) => x[1]);
  };

  // Axis A is per runtime: only the default adapter is held against the SPA; every other adapter must
  // declare its own, different list.
  const ADAPTER_DIR = ADAPTER.slice(0, ADAPTER.lastIndexOf("/") + 1); // `runtime/claude/`
  const isOtherAdapter = (file: string) =>
    file.startsWith("runtime/") && !file.startsWith(ADAPTER_DIR);

  it("finds the desktop declarations, and the right file for each axis", () => {
    // An empty scan would make every assertion below vacuously true.
    expect(declaringFiles("MESSAGE_MODES")).toContain("session-profiles.js");
    expect(declaringFiles("TOOL_MODES")).toContain(`${ADAPTER_DIR}tools.js`);
    expect(declaringFiles("TOOL_MODES").length).toBeGreaterThanOrEqual(3);
    expect(declaredToolModes().length).toBeGreaterThan(0);
  });

  it("a SECOND runtime declares its own Axis-A vocabulary, not a copy of the default's", () => {
    // Scoping to the default adapter must not let another adapter ship its mode names (no synthesised modes).
    const others = declaringFiles("TOOL_MODES").filter(isOtherAdapter);
    for (const file of others) {
      const theirs = modes(desktopSource(file), "TOOL_MODES");
      expect(theirs.length, file).toBeGreaterThan(0);
      expect(theirs, file).not.toEqual(declaredToolModes());
    }
  });

  it("session-profiles.js READS Axis A rather than declaring it — core holds no copy", () => {
    // A literal here would make the comparison measure core against itself; per-runtime lists come
    // from the descriptor through `session-profiles-runtime.js › toolModesFor`.
    const profiles = desktopSource("session-profiles.js");
    const runtimeSurface = desktopSource("session-profiles-runtime.js");
    expect(profiles).not.toMatch(/const TOOL_MODES = \[/);
    expect(runtimeSurface).not.toMatch(/const TOOL_MODES = \[/);
    expect(runtimeSurface).toMatch(/const toolModesFor = \(runtimeId\) => cap\.toolModes\(descriptorFor\(runtimeId\)\);/);
    expect(runtimeSurface).toContain("const TOOL_MODES = toolModesFor(null);");
  });

  it.each(["TOOL_MODES", "MESSAGE_MODES"])(
    "%s is one list in every tree that declares it",
    (name) => {
      // Axis B is Dopl's own enum, a literal in the gate; Axis A's winner is the descriptor.
      const winner = name === "TOOL_MODES"
        ? declaredToolModes()
        : modes(desktopSource("session-profiles.js"), name);
      // Order matters: `session-permission-axes.test.mjs` indexes it positionally; `[0]` is fail-closed.
      expect(winner.length).toBeGreaterThan(0);
      for (const file of declaringFiles(name)) {
        // Another runtime's adapter is not a copy; its own case asserts it differs.
        if (name === "TOOL_MODES" && isOtherAdapter(file)) continue;
        // The directive wire's list is the union of every adapter's words (its own case).
        if (name === "TOOL_MODES" && file === DIRECTIVE_VOCAB) continue;
        expect(modes(desktopSource(file), name), file).toEqual(winner);
      }
      expect(offered(name), WEB_MODULE).toEqual(winner);
    }
  );

  const DIRECTIVE_VOCAB = "launch-directive-vocab.js";
  it("the directive wire's applied Axis A is the union of every adapter's own list", () => {
    const adapters = declaringFiles("TOOL_MODES").filter((f) => f.startsWith("runtime/"));
    const union = adapters.flatMap((f) => modes(desktopSource(f), "TOOL_MODES"));
    expect(adapters.length).toBeGreaterThanOrEqual(3);
    expect([...modes(desktopSource(DIRECTIVE_VOCAB), "APPLIED_TOOL_MODES")].sort()).toEqual([...union].sort());
  });

  it("the web offering's FIRST option is the desktop's fail-closed answer", () => {
    // A default main would coerce away is unholdable; `runtime-contract.test.mjs` pins it as the narrowest.
    const profiles = desktopSource("session-profiles.js");
    const adapterDefault = /default: '([^']+)',/.exec(desktopSource(ADAPTER))?.[1];
    expect(adapterDefault).toBe(declaredToolModes()[0]);
    expect(offered("TOOL_MODES")[0]).toBe(adapterDefault);
    const messageFallback =
      /MESSAGE_MODES\.indexOf\(mode\) === -1 \? '([^']+)'/.exec(profiles)?.[1];
    expect(offered("MESSAGE_MODES")[0]).toBe(messageFallback);
  });
});

