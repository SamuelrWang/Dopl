import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ChannelSettingsMenuView,
  type ChannelSettingsMenuViewProps,
} from "./channel-settings-popover";
import {
  DEFAULT_PERMISSION_PRESET,
  PERMISSION_ARM_TTL_MS,
} from "../hooks/use-channel-permission-preset";
import { UNRESOLVED_TOOL_PROFILE } from "../constants";
import type { ChannelMember } from "../types";

/**
 * ⚠ The settings popover is where CONTAINMENT is explained, so its COPY is under
 * test, not its markup. Each assertion pins a claim the UI makes about what the
 * software does:
 *  - Tools is the containment control (which tools the spawned session has at
 *    all) — every profile must say what it means, in words, at the root.
 *  - Permissions and Sends are the desktop permission ARM (single use, 30-minute
 *    TTL), so the panel must say so and must never appear without the bridge.
 *  - ⚠ Trust is WORKSPACE-WIDE (`UNIQUE (operator, trusted, workspace)`, no
 *    channel column) while living in a per-CHANNEL popover, so the label is the
 *    only thing carrying the scope.
 *
 * Rendered statically — `Popover` returns null while closed and these tests have
 * no DOM to click with. The DOM half is pinned in
 * `apps/desktop-ui/src/features/channels/`.
 */

/** The desktop modules these sentences are claims ABOUT. */
function desktopSource(file: string) {
  return readFileSync(
    fileURLToPath(new URL(`../../../../dopl-desktop-app/main/${file}`, import.meta.url)),
    "utf8"
  );
}
const CHANNEL_PREFS = desktopSource("channel-prefs.js");
const TOOL_PROFILES = desktopSource("tool-profiles.js");

const noop = () => {};

function member(over: Partial<ChannelMember> = {}): ChannelMember {
  return {
    channelId: "11111111-1111-4111-8111-111111111111",
    userId: "u-alice",
    role: "member",
    lastReadAt: null,
    notifyScope: null,
    agentToolProfile: null,
    favoritedAt: null,
    agentOnline: false,
    lastSeenAt: null,
    addedBy: null,
    joinedAt: "2026-08-01T00:00:00.000Z",
    displayName: "Alice",
    email: "alice@example.com",
    avatarUrl: null,
    ...over,
  };
}

function view(over: Partial<ChannelSettingsMenuViewProps> = {}) {
  return renderToStaticMarkup(
    <ChannelSettingsMenuView
      profile="full"
      preset={DEFAULT_PERMISSION_PRESET}
      presetBusy={false}
      onChangePreset={noop}
      section={null}
      onSection={noop}
      otherMembers={[member()]}
      trustedIds={new Set()}
      trustBusyIds={new Set()}
      onSetToolProfile={noop}
      toolProfileBusy={false}
      onToggleTrust={noop}
      {...over}
    />
  );
}

/** Tags stripped, entities restored — copy assertions span elements and are
 *  written the way a person sees them, apostrophes and all. */
function text(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

describe("the root panel names three controls and shows what each is set to", () => {
  it("names Permissions, Sends and Tools", () => {
    const html = text(view());
    expect(html).toContain("Permissions");
    expect(html).toContain("Sends");
    expect(html).toContain("Tools");
  });

  it("shows each control's CURRENT value without opening anything", () => {
    // ⚠ A root row rendering a bare control name is the bug.
    const html = text(
      view({ profile: "read_only", preset: { tools: "bypass", messages: "auto_both" } })
    );
    expect(html).toContain("Permissions Bypass");
    expect(html).toContain("Sends Automatic");
    expect(html).toContain("Tools Read only");
  });

  it("carries the current value's plain-words line on the row too", () => {
    const html = text(view({ profile: "full" }));
    expect(html).toContain("Asking before each command");
    expect(html).toContain("Asking before messages in and out");
    expect(html).toContain("including the apps and MCP servers you've connected");
  });

  it("separates the ARM from the DURABLE setting by heading, not by ordering", () => {
    const html = text(view());
    expect(html).toContain("For the next request you allow");
    expect(html).toContain("For every session on this channel");
  });
});

describe("Permissions and Sends are an ARM, and the panel says so", () => {
  it("states the arm's real lifetime rather than implying a stored preference", () => {
    const html = text(view());
    expect(html).toContain("Applies to the next request you allow here");
    expect(html).toContain("expires after 30 minutes");
    expect(html).toContain("Every other session starts at Ask each time");
  });

  it("uses the SAME 30 minutes the desktop enforces", () => {
    // ⚠ Only place a person learns the arm expires — retuning
    // `main/channel-prefs.js` ARM_TTL_MS makes this sentence a lie.
    expect(CHANNEL_PREFS).toContain("const ARM_TTL_MS = 30 * 60 * 1000");
    expect(PERMISSION_ARM_TTL_MS).toBe(30 * 60 * 1000);
  });

  it("is SINGLE USE on the desktop, which is why the copy may not say 'always'", () => {
    expect(CHANNEL_PREFS).toContain("SINGLE USE");
    const html = text(view());
    expect(html).not.toMatch(/Permissions[^.]*\balways\b/i);
  });

  it("renders NO arm section at all without the desktop bridge", () => {
    // A plain browser has nothing to arm; a dead control claiming to set a
    // posture is worse than none.
    const html = text(view({ preset: null }));
    expect(html).not.toContain("For the next request you allow");
    expect(html).not.toContain("Permissions");
    expect(html).not.toContain("Sends");
    expect(html).toContain("Tools Full access");
  });
});

describe("Tools — every profile says what it actually means", () => {
  it("describes all three, never a bare enum name", () => {
    for (const profile of ["full", "dopl_only", "read_only"] as const) {
      const html = text(view({ profile, section: "tools" }));
      expect(html).not.toContain(profile);
    }
    const html = text(view({ section: "tools" }));
    expect(html).toContain("Full access");
    expect(html).toContain("Dopl only");
    expect(html).toContain("Read only");
  });

  it("says plainly that FULL includes the operator's own connectors", () => {
    // `full` is the one profile with NO `--strict-mcp-config`, so the operator's
    // global MCP servers load — deliberately. The copy's job is to inform.
    const html = text(view({ section: "tools" }));
    expect(html).toContain("Everything your agent can normally do");
    expect(html).toContain("including the apps and MCP servers you've connected");
    expect(TOOL_PROFILES).toContain("full: [],");
    // `full`'s whole flag set: one deny floor, nothing narrowing the connectors.
    expect(TOOL_PROFILES).toMatch(
      /if \(p === 'full'\) return \['--disallowedTools', UNIVERSAL_HARD_DENY/
    );
  });

  it("does not generalize the deny floor, which is not the same on both lanes", () => {
    // ⚠ `full` carries UNIVERSAL_HARD_DENY, but the SDK lane's SESSION_HARD_DENY
    // is BROADER on purpose — so "destructive tools are always denied" would be
    // true on one lane and wrong on the other. The menu describes what is
    // GRANTED instead.
    const html = text(view({ section: "tools" }));
    expect(html).not.toMatch(/always denied|never allowed|hard.?den/i);
    expect(html).not.toMatch(/\bsafe\b|\bsecure\b|\bprotected\b/i);
    expect(TOOL_PROFILES).toContain(
      "const UNIVERSAL_HARD_DENY = [...DOPL_ADMIN_TOOLS, ...RETIRED_DOPL_TOOLS]"
    );
  });

  it("does not rank the restricted profiles as the 'safe' or recommended answer", () => {
    // The menu describes SCOPE, not virtue — `dopl_only` is not "more dangerous"
    // than `full`.
    const html = text(view({ section: "tools" }));
    expect(html).not.toMatch(/recommended|safest|safer|most secure/i);
    expect(TOOL_PROFILES).toContain("dopl_only MORE dangerous than full");
  });

  it("matches what each restricted profile is actually granted", () => {
    const html = text(view({ section: "tools" }));
    // dopl_only = local reads + web + non-admin Dopl tools; no shell/writes.
    expect(html).toContain("Your files, the web, and your Dopl workspace");
    expect(html).toContain("No shell, no file writes, no other connectors");
    expect(TOOL_PROFILES).toContain(
      "dopl_only: [...READ_BUILTINS, ...WEB_TOOLS, ...DOPL_SAFE_TOOLS]"
    );
    // read_only = local reads only; Dopl server and web both denied by prefix,
    // so it is the one profile with no outbound channel.
    expect(html).toContain("Your local files, and nothing else");
    expect(html).toContain("No web, no Dopl, no writes, no way to send anything out");
    expect(TOOL_PROFILES).toContain("read_only: [...READ_BUILTINS]");
  });

  it("shows the profile the DESKTOP would run when the row carries none", () => {
    // ⚠ Desktop `normalizeProfile` resolves unknown/missing to read_only. A web
    // fallback of `"full"` is a fail-OPEN label over a session the machine runs
    // read_only. One answer, both sides.
    expect(UNRESOLVED_TOOL_PROFILE).toBe("read_only");
    expect(TOOL_PROFILES).toMatch(
      /function normalizeProfile[\s\S]*?return 'read_only';/
    );
    expect(text(view({ profile: UNRESOLVED_TOOL_PROFILE }))).toContain(
      "Tools Read only"
    );
  });

  it("says Tools is the durable one, and that it applies to every session here", () => {
    const html = text(view({ section: "tools" }));
    expect(html).toContain("Which tools the session has at all");
    expect(html).toContain("applies to every session here");
  });
});

describe("trust is labelled with the scope it actually has", () => {
  it("says workspace-wide, and that it reaches channels created later", () => {
    const html = text(view());
    expect(html).toContain("Trust covers the whole workspace");
    expect(html).toContain("every channel and DM you share");
    expect(html).toContain("including ones created later");
  });

  it("says what trusting someone DOES — no card, a session starts", () => {
    const html = text(view());
    expect(html).toContain("skip the approval card");
    expect(html).toContain("start a session straight away");
  });

  it("names the tool scope that session gets, since the two settings meet here", () => {
    expect(text(view())).toContain("whatever this channel's Tools setting allows");
  });

  it("never describes trust as per-channel", () => {
    // ⚠ Copy naming no scope inside a per-channel popover reads as per-channel.
    const html = text(view());
    expect(html).not.toContain("Trusted teammates' requests run without a prompt");
    expect(html).not.toMatch(/in this channel[^.]*trust/i);
  });

  it("still explains trust when there is nobody to point it at", () => {
    // ⚠ Rendering nothing on an empty roster hides that standing trust exists
    // from a single-member workspace.
    const html = text(view({ otherMembers: [] }));
    expect(html).toContain("Always allow");
    expect(html).toContain("Trust covers the whole workspace");
    expect(html).toContain("Nobody else is in this channel yet");
  });

  it("lists the other members with their trusted state when there are any", () => {
    const html = view({
      otherMembers: [member(), member({ userId: "u-bo", displayName: "Bo" })],
      trustedIds: new Set(["u-bo"]),
    });
    expect(text(html)).toContain("Alice");
    expect(text(html)).toContain("Bo");
    // One check column per row; only Bo's is visible (`opacity-0`).
    expect((html.match(/opacity-0/g) ?? []).length).toBe(1);
  });

  it("marks a row in flight rather than letting a second click race it", () => {
    expect(text(view({ trustBusyIds: new Set(["u-alice"]) }))).toContain("Saving…");
  });
});

describe("drilling into a control", () => {
  it("shows every option with its explanation inline", () => {
    const html = text(view({ section: "permissions" }));
    for (const label of ["Ask each time", "Accept edits", "Auto", "Bypass"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Auto approving every command the tool profile allows");
  });

  it("shows the message axis under Sends", () => {
    const html = text(view({ section: "sends" }));
    expect(html).toContain("Auto accept in");
    expect(html).toContain("Auto send out");
    expect(html).toContain("Messages flow automatically");
  });

  it("falls back to the root when an arm section is drilled with no bridge", () => {
    // Bridge lost mid-drill (or SSR): never a blank panel.
    const html = text(view({ section: "permissions", preset: null }));
    expect(html).toContain("Tools Full access");
    expect(html).toContain("Always allow");
  });

  it("offers a way back out of every drilled panel", () => {
    for (const section of ["permissions", "sends", "tools"] as const) {
      const html = view({ section });
      expect(html, `${section} needs a back row`).toContain("lucide-chevron-left");
    }
  });
});

describe("design system", () => {
  it("uses tokens and the type scale, never a raw hex or px", () => {
    const html = view();
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(html).not.toMatch(/text-\[\d/);
    expect(html).not.toMatch(/\btext-(xs|sm|base|lg)\b/);
    expect(html).toContain("text-micro");
    expect(html).toContain("text-caption");
    expect(html).toContain("text-text-muted");
  });
});

