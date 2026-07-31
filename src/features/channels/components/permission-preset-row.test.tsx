import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MESSAGE_OPTIONS,
  RequestPermissionRow,
  RequestPermissionRowView,
  TOOL_OPTIONS,
} from "./permission-preset-row";
import {
  DEFAULT_PERMISSION_PRESET,
  getDesktopPermissionPresets,
  normalizePermissionPreset,
  type PermissionPreset,
} from "../hooks/use-channel-permission-preset";

const CHANNEL_ID = "44444444-4444-4444-8444-444444444444";
const noop = () => {};

/** The desktop session window's posture copy — the source this UI must preserve. */
const SESSION_LABELS = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../dopl-desktop-app/renderer/session/session-labels.js",
      import.meta.url
    )
  ),
  "utf8"
);

function view(preset: PermissionPreset, busy = false) {
  return renderToStaticMarkup(
    <RequestPermissionRowView preset={preset} busy={busy} onChange={noop} />
  );
}

// Tests that define `window` clean it up so the render tests see the true
// "no bridge on the server / in a plain browser" state.
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe("the frozen enums and their defaults", () => {
  it("defaults to the most restrictive pair on both axes", () => {
    expect(DEFAULT_PERMISSION_PRESET).toEqual({ tools: "manual", messages: "ask" });
  });

  it("offers exactly the desktop's real modes, in order, on both axes", () => {
    expect(TOOL_OPTIONS.map((o) => o.value)).toEqual([
      "manual",
      "accept_edits",
      "auto",
      "bypass",
    ]);
    expect(MESSAGE_OPTIONS.map((o) => o.value)).toEqual([
      "ask",
      "auto_inbound",
      "auto_outbound",
      "auto_both",
    ]);
  });

  it("rejects an unknown mode on either axis rather than coercing it", () => {
    expect(normalizePermissionPreset({ tools: "auto", messages: "auto_both" })).toEqual({
      tools: "auto",
      messages: "auto_both",
    });
    expect(normalizePermissionPreset({ tools: "root", messages: "ask" })).toBeNull();
    expect(normalizePermissionPreset({ tools: "bypass" })).toBeNull();
    expect(normalizePermissionPreset(null)).toBeNull();
    expect(normalizePermissionPreset("bypass")).toBeNull();
  });
});

describe("every option states, in plain words, what it does", () => {
  it("gives each option a description, never a bare enum name", () => {
    for (const option of [...TOOL_OPTIONS, ...MESSAGE_OPTIONS]) {
      expect(option.description, `${option.value} needs plain-words copy`).toBeTruthy();
      expect(option.description).not.toContain(option.value);
    }
  });

  it("carries the desktop's posture copy VERBATIM (a security review wrote it)", () => {
    // If someone reworded a line here, it must be reworded in
    // renderer/session/session-labels.js too — the two surfaces describe the
    // same eight postures and must not drift.
    for (const option of [...TOOL_OPTIONS, ...MESSAGE_OPTIONS]) {
      expect(
        SESSION_LABELS,
        `"${option.description}" is not the session window's copy for ${option.value}`
      ).toContain(option.description as string);
    }
  });

  it("names the blast radius on the permissive tool modes", () => {
    const byValue = Object.fromEntries(TOOL_OPTIONS.map((o) => [o.value, o.description]));
    expect(byValue.bypass).toContain("every command the tool profile allows");
    expect(byValue.auto).toContain("asking for shell, web and workspace writes");
  });

  // The bypass line used to read "auto approving every command on this machine", which is
  // simply FALSE under a read_only or dopl_only profile: the profile's `disallowedTools`
  // (plus the credential-path deny rules) bound the session at the SDK's tool-binding layer,
  // where no permission axis can reach them. Bypass auto-approves everything that reaches
  // OUR gate — which is not everything on the machine. The card must not promise more reach
  // than the profile grants, in either direction.
  it("does not claim a reach the tool profile does not actually grant", () => {
    const byValue = Object.fromEntries(TOOL_OPTIONS.map((o) => [o.value, o.description]));
    expect(byValue.bypass).not.toContain("on this machine");
    expect(byValue.bypass).toMatch(/tool profile/);
  });
});

describe("RequestPermissionRowView (both dropdowns, kit-only)", () => {
  it("renders two dropdown triggers, one per axis", () => {
    const markup = view(DEFAULT_PERMISSION_PRESET);
    expect((markup.match(/aria-haspopup="menu"/g) ?? []).length).toBe(2);
    expect(markup).toContain(">Tools</span>");
    expect(markup).toContain(">Messages</span>");
    expect(markup).toContain('aria-label="What this session&#x27;s agent may do"');
    expect(markup).toContain('aria-label="Which messages cross without asking"');
  });

  it("shows the CURRENT posture on each trigger, copy and all", () => {
    const markup = view({ tools: "bypass", messages: "auto_both" });
    expect(markup).toContain("Bypass");
    expect(markup).toContain("Automatic");
    // The selected option's plain-words line rides on the trigger too, so the
    // posture is readable without opening the menu.
    expect(markup).toContain('title="Auto approving every command the tool profile allows"');
    expect(markup).toContain('title="Messages flow automatically"');
  });

  it("shows the defaults when nothing is stored for the channel", () => {
    const markup = view(DEFAULT_PERMISSION_PRESET);
    expect(markup).toContain('title="Asking before each command"');
    expect(markup).toContain('title="Asking before messages in and out"');
  });

  it("is a kit dropdown, never a bare native select", () => {
    const markup = view(DEFAULT_PERMISSION_PRESET);
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain("<option");
  });

  it("wears the same pill recipe as the folder control it sits beside", () => {
    const markup = view(DEFAULT_PERMISSION_PRESET);
    expect(markup).toContain("rounded-full");
    expect(markup).toContain("border-border-strong");
    expect(markup).toContain("bg-bg-inset");
    expect(markup).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("disables both pills while a write is in flight", () => {
    const markup = view(DEFAULT_PERMISSION_PRESET, true);
    expect((markup.match(/disabled=""/g) ?? []).length).toBe(2);
  });
});

describe("the desktop gate (getDesktopPermissionPresets)", () => {
  it("returns the bridge only when BOTH preset ops are functions", () => {
    (globalThis as { window?: unknown }).window = {
      dopl: {
        channels: {
          getPermissionPreset: vi.fn(),
          setPermissionPreset: vi.fn(),
        },
      },
    };
    expect(getDesktopPermissionPresets()).not.toBeNull();
  });

  it("returns null in a plain browser (no window.dopl)", () => {
    (globalThis as { window?: unknown }).window = {};
    expect(getDesktopPermissionPresets()).toBeNull();
  });

  it("returns null on an older desktop build (folder API but no preset API)", () => {
    (globalThis as { window?: unknown }).window = {
      dopl: { isDesktop: true, channels: { chooseFolder: vi.fn() } },
    };
    expect(getDesktopPermissionPresets()).toBeNull();
  });

  it("renders NOTHING without the bridge (no dead control)", () => {
    expect(renderToStaticMarkup(<RequestPermissionRow channelId={CHANNEL_ID} />)).toBe(
      ""
    );
  });
});
