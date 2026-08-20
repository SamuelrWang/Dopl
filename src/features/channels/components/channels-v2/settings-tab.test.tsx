// @vitest-environment jsdom
/**
 * THE RIGHT PANEL'S SETTINGS TAB — every setting INLINE (Samuel, 2026-08-19,
 * live review). The tab layout, the Channel action rows, and the agent half's
 * copy + controls are all asserted here.
 *
 * ⚠ THIS FILE INHERITS TWO DELETED SUITES, AND IT INHERITED THEM IN THAT ORDER.
 *
 * FROM `components/channel-actions-menu.test.tsx` (deleted with the kebab):
 *  - **Q2 — A DM MAY NEVER OFFER "Leave channel".** Leaving deletes one of the
 *    pair's two `channel_members` rows, which destroys the conversation
 *    permanently (the live row keeps the pair's `direct_key` reserved, so a
 *    fresh DM cannot be opened either) — and the non-creator, whose `role` is
 *    `member`, was the one being offered it, one click, no confirmation. Both DM
 *    participants get the reversible "Delete conversation" instead.
 *  - **A DM has no visibility toggle** — it is private by DB CHECK.
 *  - **A non-member viewing a public channel has nothing to manage**, and must
 *    not be shown a heading over an empty section.
 *
 * FROM `components/channel-settings-popover.test.tsx` (deleted with the popover
 * the inlining ruling replaced) — its assertions were about COPY, and ⚠ **most
 * of that copy is gone (Samuel, 2026-08-19 — minimal copy): "we should not be
 * explaining everything to the user."** Every explainer paragraph was cut and
 * its assertion with it; `› a settings panel, not documentation` replaces the
 * lot with a MEASUREMENT — a word bound over the tab's `text-caption` nodes —
 * which goes red for a new explainer under ANY control, including one nobody
 * thought to forbid. **A new `expect(text).toContain(<a sentence>)` here is a
 * regression.** What stayed is load-bearing: the HEADINGS (now the only
 * statement of the backing-store-and-lifetime split), Tools' few-word GRANTS
 * lines, trust's SCOPE, and the desktop SOURCE cross-checks (code vs code).
 *
 * ⚠ AND THE RULE NEITHER OF THEM HAD: **NO DEAD ROWS** (INVARIANTS §5 — every
 * row on this surface functions) and **NOTHING BEHIND A CLICK**. jsdom has no
 * `window.dopl`, so the default case below is a plain browser: the arm and the
 * folder are absent, headings included.
 *
 * The rows report INTENT; `channel-manage.tsx` owns the confirm dialogs and the
 * writes, exactly as it did when the intent came from a menu item.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChannelsV2SettingsTab } from "./settings-tab";
import {
  ChannelAgentSettings,
  ChannelAgentSettingsView,
  type ChannelAgentSettingsViewProps,
} from "./settings-agent";
import { channel, member as makeMember } from "./test-fixtures";
import {
  DEFAULT_PERMISSION_PRESET,
  PERMISSION_ARM_TTL_MS,
} from "../../hooks/use-channel-permission-preset";
import { UNRESOLVED_TOOL_PROFILE } from "../../constants";
import type { Channel } from "../../types";

afterEach(cleanup);

/** The desktop modules this tab's remaining claims are ABOUT. ⚠ Off
 *  `process.cwd()` (the vitest root), not `import.meta.url`: under the jsdom
 *  environment this file declares, a module-relative URL misses the tree. */
function desktopSource(file: string) {
  return readFileSync(resolve(process.cwd(), "dopl-desktop-app/main", file), "utf8");
}
const CHANNEL_PREFS = desktopSource("channel-prefs.js");
const TOOL_PROFILES = desktopSource("tool-profiles.js");

const dm = { isDirect: true, visibility: "private" as const };
const noop = () => {};

/** The agent half on its own, with the two desktop-only halves injected — the
 *  view renders with no window and no bridge, which is the whole reason it is
 *  split from `ChannelAgentSettings`. */
function agentView(over: Partial<ChannelAgentSettingsViewProps> = {}) {
  return render(
    <ChannelAgentSettingsView
      profile="full"
      onSetToolProfile={noop}
      toolProfileBusy={false}
      preset={DEFAULT_PERMISSION_PRESET}
      presetBusy={false}
      onChangePreset={noop}
      folder={null}
      otherMembers={[makeMember({ userId: "u-alice", displayName: "Alice" })]}
      trustedIds={new Set()}
      trustBusyIds={new Set()}
      onToggleTrust={noop}
      {...over}
    />
  );
}

/** The whole tab, with the agent half mounted through its REAL bridge-detecting
 *  wrapper (jsdom = a plain browser). */
function mount(over: Partial<Channel>, canManage: boolean, handlers = {}) {
  const props = {
    onInvite: vi.fn(),
    onToggleVisibility: vi.fn(),
    onToggleArchive: vi.fn(),
    onRequestDelete: vi.fn(),
    onRequestLeave: vi.fn(),
    ...handlers,
  };
  const ch = channel(over);
  render(
    <ChannelsV2SettingsTab
      channel={ch}
      canManage={canManage}
      agent={
        ch.isMember ? (
          <ChannelAgentSettings
            channelId={ch.id}
            profile={ch.myAgentToolProfile ?? UNRESOLVED_TOOL_PROFILE}
            otherMembers={[]}
            trustedIds={new Set()}
            trustBusyIds={new Set()}
            onSetToolProfile={vi.fn()}
            toolProfileBusy={false}
            onToggleTrust={vi.fn()}
          />
        ) : null
      }
      {...props}
    />
  );
  return props;
}

const row = (name: string) => screen.queryByRole("button", { name });
/** ⚠ The root suite has no jest-dom — `toBeDisabled` does not exist here. */
const disabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled;
const option = (name: RegExp | string) => screen.getByRole("radio", { name });
/** Rendered copy, the way a person reads it — assertions span elements. */
const copy = (over: Partial<ChannelAgentSettingsViewProps> = {}) =>
  agentView(over).container.textContent ?? "";
const armTools = () => screen.getByLabelText("Permissions for the next request you allow");
const armSends = () => screen.getByLabelText("Sends for the next request you allow");

describe("the DM has no Leave", () => {
  it("offers the non-owner DM peer Delete conversation, never Leave channel", () => {
    // The DM's non-creator, so `role: "member"` → canManage false. This is the
    // exact user the destructive item used to be rendered for.
    mount({ ...dm, role: "member" }, false);
    expect(row("Leave channel")).toBeNull();
    expect(row("Delete conversation")).not.toBeNull();
  });

  it("offers the DM creator the same Delete conversation", () => {
    mount({ ...dm, role: "owner" }, true);
    expect(row("Leave channel")).toBeNull();
    expect(row("Delete conversation")).not.toBeNull();
    // A DM is private by DB CHECK — no visibility toggle either.
    expect(row("Make public")).toBeNull();
    expect(row("Make private")).toBeNull();
    // And a fixed 1:1 pair has no invite (the server also rejects one).
    expect(row("Add members")).toBeNull();
  });

  it("still offers Leave channel in a NON-direct channel", () => {
    mount({ role: "member" }, false);
    expect(row("Leave channel")).not.toBeNull();
    expect(row("Delete conversation")).toBeNull();
  });
});

describe("the owner's manage set", () => {
  it("keeps all four items on a non-direct channel", () => {
    mount({ role: "owner", visibility: "private" }, true);
    expect(row("Add members")).not.toBeNull();
    expect(row("Make public")).not.toBeNull();
    expect(row("Archive")).not.toBeNull();
    expect(row("Delete channel")).not.toBeNull();
    expect(row("Leave channel")).toBeNull();
  });

  it("flips the visibility label to match the current state", () => {
    mount({ role: "owner", visibility: "public" }, true);
    expect(row("Make private")).not.toBeNull();
    expect(row("Make public")).toBeNull();
  });

  it("offers Unarchive on an archived channel", () => {
    mount({ role: "owner", archivedAt: "2026-08-01T00:00:00.000Z" }, true);
    expect(row("Unarchive")).not.toBeNull();
    expect(row("Archive")).toBeNull();
  });

  it("hides the manage half from a plain member", () => {
    mount({ role: "member" }, false);
    expect(row("Make public")).toBeNull();
    expect(row("Archive")).toBeNull();
    expect(row("Delete channel")).toBeNull();
  });
});

describe("the rows report intent — they never write", () => {
  it("hands the destructive pair to the confirm dialogs", () => {
    const props = mount({ role: "owner" }, true);
    fireEvent.click(row("Delete channel")!);
    expect(props.onRequestDelete).toHaveBeenCalledTimes(1);

    cleanup();
    const member = mount({ role: "member" }, false);
    fireEvent.click(row("Leave channel")!);
    expect(member.onRequestLeave).toHaveBeenCalledTimes(1);
  });

  it("opens the invite dialog from its own row", () => {
    const props = mount({ role: "owner" }, true);
    fireEvent.click(row("Add members")!);
    expect(props.onInvite).toHaveBeenCalledTimes(1);
  });
});

describe("no dead rows, and nothing behind a click", () => {
  it("renders NO agent-folder row and NO arm without the desktop bridge", () => {
    // ⚠ Both are desktop-only. A labelled row around a control that renders
    // nothing is a heading over an empty right-hand side; jsdom has no
    // `window.dopl`, so this is the plain-browser case.
    mount({ role: "owner" }, true);
    expect(screen.queryByText("Agent folder")).toBeNull();
    expect(screen.queryByText("For the next request you allow")).toBeNull();
    expect(screen.queryByText("Permissions")).toBeNull();
    expect(screen.queryByText("Sends")).toBeNull();
    // The DURABLE half is a cloud write and is there either way.
    expect(screen.getByRole("radiogroup", { name: "Tools" })).toBeTruthy();
  });

  it("says so, rather than heading an empty tab, for a non-member", () => {
    render(
      <ChannelsV2SettingsTab
        channel={channel({ isMember: false, role: null })}
        canManage={false}
        agent={null}
        onInvite={vi.fn()}
        onToggleVisibility={vi.fn()}
        onToggleArchive={vi.fn()}
        onRequestDelete={vi.fn()}
        onRequestLeave={vi.fn()}
      />
    );
    expect(screen.getByText("Nothing to manage")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("puts no setting behind a menu — the tab owns no `role=menu`", () => {
    // ⚠ The ruling this file records: the popover and its drill-down panels are
    // gone. A `menu` here would mean one came back.
    mount({ role: "owner" }, true);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("menuitem")).toBeNull();
  });
});

describe("the ARM renders with its current values, and changes on selection", () => {
  it("shows both axes' current values without opening anything", () => {
    agentView({ preset: { tools: "bypass", messages: "auto_both" } });
    expect(armTools().textContent).toContain("Bypass");
    expect(armSends().textContent).toContain("Automatic");
  });

  it("writes the picked mode back on the axis it belongs to", () => {
    const onChangePreset = vi.fn();
    agentView({ onChangePreset });
    fireEvent.click(armTools());
    fireEvent.click(screen.getByRole("menuitem", { name: /^Bypass/ }));
    expect(onChangePreset).toHaveBeenCalledWith({ tools: "bypass" });
  });

  it("goes inert while an arm write is in flight", () => {
    agentView({ presetBusy: true });
    expect(disabled(armTools())).toBe(true);
    expect(disabled(armSends())).toBe(true);
  });

  it("is an ARM by HEADING alone, over a desktop that really is short-lived", () => {
    // ⚠ Since the 2026-08-19 copy cut these two headings state the BACKING
    // STORE AND LIFETIME split and nothing else does. The expiry is no longer
    // printed, so the heading is honest only while the desktop stays single-use
    // and 30-minute — retuning `channel-prefs.js` ARM_TTL_MS is what this catches.
    const text = copy();
    expect(text).toContain("For the next request you allow");
    expect(text).toContain("For every session on this channel");
    expect(CHANNEL_PREFS).toContain("const ARM_TTL_MS = 30 * 60 * 1000");
    expect(PERMISSION_ARM_TTL_MS).toBe(30 * 60 * 1000);
    expect(CHANNEL_PREFS).toContain("SINGLE USE");
    expect(text).not.toMatch(/Permissions[^.]*\balways\b/i);
  });

  it("drops the whole arm subsection, heading included, with no bridge", () => {
    const text = copy({ preset: null });
    expect(text).not.toContain("For the next request you allow");
    expect(screen.queryByText("Permissions")).toBeNull();
    expect(screen.queryByText("Sends")).toBeNull();
    // The durable control survives — it is not desktop-gated.
    expect(screen.getByRole("radio", { name: /Full access/ })).toBeTruthy();
  });
});

describe("Tools — every profile says what it means, in a few words", () => {
  it("shows all three with their short lines, and matches what each is granted", () => {
    const text = copy();
    for (const label of ["Full access", "Dopl only", "Read only"]) {
      expect(screen.getByRole("radio", { name: new RegExp(label) })).toBeTruthy();
    }
    // ⚠ Never a bare enum name.
    for (const value of ["full", "dopl_only", "read_only"]) {
      expect(text).not.toContain(value);
    }
    // ⚠ THE ONLY DESCRIPTIONS LEFT ON THE TAB, ≤5 words each (Samuel,
    // 2026-08-19) — Tools keeps one because it is the CONTAINMENT pick.
    expect(text).toContain("Everything, including connected apps");
    expect(text).toContain("Files, web, and Dopl");
    expect(text).toContain("Local files only");
    expect(TOOL_PROFILES).toContain("full: [],");
    expect(TOOL_PROFILES).toMatch(
      /if \(p === 'full'\) return \['--disallowedTools', UNIVERSAL_HARD_DENY/
    );
    expect(TOOL_PROFILES).toContain(
      "dopl_only: [...READ_BUILTINS, ...WEB_TOOLS, ...DOPL_SAFE_TOOLS]"
    );
    expect(TOOL_PROFILES).toContain("read_only: [...READ_BUILTINS]");
  });

  it("does not generalize the deny floor, which differs between the two lanes", () => {
    // ⚠ `full` carries UNIVERSAL_HARD_DENY, but the SDK lane's SESSION_HARD_DENY
    // is BROADER on purpose — so "destructive tools are always denied" would be
    // true on one lane and wrong on the other. The copy describes what is
    // GRANTED instead, and ranks nothing as the safe answer.
    const text = copy();
    expect(text).not.toMatch(/always denied|never allowed|hard.?den/i);
    expect(text).not.toMatch(/\bsafe\b|\bsecure\b|\bprotected\b/i);
    expect(text).not.toMatch(/recommended|safest|safer|most secure/i);
    expect(TOOL_PROFILES).toContain(
      "const UNIVERSAL_HARD_DENY = [...DOPL_ADMIN_TOOLS, ...RETIRED_DOPL_TOOLS]"
    );
    expect(TOOL_PROFILES).toContain("dopl_only MORE dangerous than full");
  });

  it("marks exactly one profile checked, and resolves an absent one the DESKTOP's way", () => {
    // ⚠ Desktop `normalizeProfile` resolves unknown/missing to read_only. A web
    // fallback of `"full"` is a fail-OPEN label over a session the machine runs
    // read_only. One answer, both sides.
    expect(UNRESOLVED_TOOL_PROFILE).toBe("read_only");
    expect(TOOL_PROFILES).toMatch(
      /function normalizeProfile[\s\S]*?return 'read_only';/
    );
    agentView({ profile: UNRESOLVED_TOOL_PROFILE });
    expect(option(/Read only/).getAttribute("aria-checked")).toBe("true");
    expect(option(/Full access/).getAttribute("aria-checked")).toBe("false");
    expect(option(/Dopl only/).getAttribute("aria-checked")).toBe("false");
  });

  it("picks through the caller's cloud mutation, and refuses a re-pick", () => {
    const onSetToolProfile = vi.fn();
    agentView({ onSetToolProfile });
    fireEvent.click(option(/Read only/));
    expect(onSetToolProfile).toHaveBeenCalledWith("read_only");
    // Already-selected is a no-op, not a second write.
    fireEvent.click(option(/Full access/));
    expect(onSetToolProfile).toHaveBeenCalledTimes(1);
  });

  it("goes inert while the durable write is in flight", () => {
    const onSetToolProfile = vi.fn();
    agentView({ toolProfileBusy: true, onSetToolProfile });
    expect(disabled(option(/Read only/))).toBe(true);
    fireEvent.click(option(/Read only/));
    expect(onSetToolProfile).not.toHaveBeenCalled();
  });
});

describe("the Agent folder row", () => {
  const folder = {
    label: null as string | null,
    busy: false,
    onChoose: noop,
    onClear: noop,
  };

  it("names the default folder and offers only Change on it", () => {
    const text = copy({ folder: { ...folder } });
    expect(text).toContain("Agent folder");
    expect(text).toContain("Sandbox (default)");
    expect(row("Change folder…")).not.toBeNull();
    expect(row("Use default")).toBeNull();
  });

  it("shows the abbreviated label and both actions once a folder is set", () => {
    // ⚠ The bridge only ever hands back an abbreviation; the absolute path never
    // reaches this page, so the row renders what it was given and no more.
    const onChoose = vi.fn();
    const onClear = vi.fn();
    const { container } = agentView({
      folder: { ...folder, label: "~/Downloads/repo", onChoose, onClear },
    });
    expect(container.textContent).toContain("~/Downloads/repo");
    fireEvent.click(row("Change folder…")!);
    fireEvent.click(row("Use default")!);
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("says the picker is open rather than looking idle", () => {
    agentView({ folder: { ...folder, label: "~/repo", busy: true } });
    expect(row("Opening picker…")).not.toBeNull();
    expect(disabled(row("Opening picker…")!)).toBe(true);
  });
});

describe("trust is labelled with the scope it actually has", () => {
  it("carries the SCOPE, and still shows the section with nobody to point it at", () => {
    // ⚠ Two short lines, not an explanation. SCOPE is the one claim a
    // per-CHANNEL tab cannot leave implicit (the row is UNIQUE (operator,
    // trusted, workspace), no channel column; saying nothing reads as
    // per-channel), and an empty roster rendering nothing would hide that
    // standing trust exists at all. Both survived the 2026-08-19 cut for that.
    const text = copy({ otherMembers: [] });
    expect(text).toContain("Always allow");
    expect(text).toContain("Applies across the whole workspace");
    expect(text).toContain("Nobody else in this channel yet");
    expect(text).not.toMatch(/in this channel[^.]*trust/i);
  });

  it("gives each teammate a real switch carrying their current state", () => {
    const named = (n: string) => screen.getByRole("switch", { name: `Always allow ${n}` });
    agentView({
      otherMembers: [
        makeMember({ userId: "u-alice", displayName: "Alice" }),
        makeMember({ userId: "u-bo", displayName: "Bo" }),
      ],
      trustedIds: new Set(["u-bo"]),
    });
    expect(named("Alice").getAttribute("aria-checked")).toBe("false");
    expect(named("Bo").getAttribute("aria-checked")).toBe("true");
  });

  it("toggles a teammate through the caller's mutation", () => {
    const onToggleTrust = vi.fn();
    agentView({ onToggleTrust });
    fireEvent.click(screen.getByRole("switch", { name: "Always allow Alice" }));
    expect(onToggleTrust).toHaveBeenCalledWith("u-alice", true);
  });

  it("marks a row in flight and refuses the second click that would race it", () => {
    const onToggleTrust = vi.fn();
    const busy = new Set(["u-alice"]);
    expect(copy({ trustBusyIds: busy, onToggleTrust })).toContain("Saving…");
    const toggle = screen.getByRole("switch", { name: "Always allow Alice" });
    expect(disabled(toggle)).toBe(true);
    fireEvent.click(toggle);
    expect(onToggleTrust).not.toHaveBeenCalled();
  });
});

describe("a settings panel, not documentation", () => {
  /** The whole agent half with both desktop-only groups present. */
  const fullTab = () =>
    agentView({
      folder: { label: "~/repo", busy: false, onChoose: noop, onClear: noop },
    }).container;

  it("keeps every secondary line short, and prints none of the cut copy", () => {
    // ⚠ SAMUEL'S 2026-08-19 RULING AS A MEASUREMENT (live review): "we should
    // not be explaining everything to the user." Every secondary line is
    // `text-caption`, so the rule is a bound on those nodes — red for a new
    // explainer under ANY control (a mid-string ". " is the paragraph shape it
    // names; ellipses are not). The four named pins are the SHORT deletions the
    // bound cannot catch; each is still TRUE and lives on as a docblock in
    // `settings-agent.tsx` — the tab just stopped PRINTING it.
    const tab = fullTab();
    const lines = Array.from(
      tab.querySelectorAll<HTMLElement>('[class*="text-caption"]')
    )
      .map((el) => el.textContent?.trim() ?? "")
      .filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.split(/\s+/).length).toBeLessThanOrEqual(8);
      expect(line).not.toMatch(/\.\s+\S/);
    }
    const text = tab.textContent ?? "";
    expect(text).not.toContain("expires after 30 minutes");
    expect(text).not.toContain("Which tools the session has at all");
    expect(text).not.toContain("Context, not a sandbox");
    expect(text).not.toContain("skip the approval card");
  });

  it("uses tokens and the type scale, never a raw hex or px", () => {
    const html = fullTab().innerHTML;
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(html).not.toMatch(/text-\[\d/);
    expect(html).not.toMatch(/\btext-(xs|sm|base|lg)\b/);
    expect(html).toContain("text-caption");
    expect(html).toContain("text-body");
    expect(html).toContain("text-text-primary");
  });
});
