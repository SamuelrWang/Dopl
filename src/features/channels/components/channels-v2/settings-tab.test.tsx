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

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChannelsV2SettingsTab } from "./settings-tab";
import { channel } from "./test-fixtures";
import { ChannelAgentSettings } from "./settings-agent";
import { agentView, copy, desktopSource, disabled } from "./settings-agent-harness";
import { UNRESOLVED_TOOL_PROFILE } from "../../constants";
import type { Channel } from "../../types";

afterEach(cleanup);

const TOOL_PROFILES = desktopSource("tool-profiles.js");

const dm = { isDirect: true, visibility: "private" as const };
const noop = () => {};

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
            onSetToolProfile={vi.fn()}
            toolProfileBusy={false}
          />
        ) : null
      }
      {...props}
    />
  );
  return props;
}

const row = (name: string) => screen.queryByRole("button", { name });
const option = (name: RegExp | string) => screen.getByRole("radio", { name });

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
    // ⚠ AND THE MACHINE-SCOPED GROUP (2026-08-22) — heading included. Its
    // bridge is `dopl.orchestratorLaunch`, absent here, so a browser must not
    // be shown a switch that grants a capability nothing can store.
    expect(screen.queryByText("Orchestrator launches")).toBeNull();
    expect(screen.queryByText("On this Mac, every channel")).toBeNull();
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

/**
 * ⚠ THE TRUST SUITE STOOD HERE AND IS DELETED (Samuel, 2026-08-22). "Always
 * allow <teammate>" was standing consent for an INBOUND ask — the decision that
 * ruling retired everywhere — so the section, its scope hint, its empty-roster
 * line, its switches and the four tests pinning them all went together. Kept as
 * an ABSENCE below, because a section nobody asserts is a section that quietly
 * comes back.
 */
describe("the tab offers no standing approval", () => {
  it("renders no Always-allow section and no trust switch", () => {
    const text = copy();
    expect(text).not.toContain("Always allow");
    expect(text).not.toContain("Applies across the whole workspace");
    expect(screen.queryByRole("switch", { name: /Always allow/ })).toBeNull();
  });
});

describe("a settings panel, not documentation", () => {
  /** The whole agent half with both desktop-only groups present. */
  const fullTab = () =>
    agentView({
      folder: { label: "~/repo", busy: false, onChoose: noop, onClear: noop },
      orchestrator: { on: false, busy: false, onToggle: noop },
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

/**
 * ORCHESTRATOR LAUNCHES — the one PER-MACHINE control on a per-channel tab
 * (2026-08-22).
 *
 * ⚠ THE FAILURE THIS GUARDS IS A MISREAD, NOT A CRASH. Every other group here
 * governs `(this channel, this Mac)`. An operator who reads this one the same
 * way turns it on "for #website" and has in fact handed an external Claude
 * session their whole machine, every channel. **The GROUP LABEL is the entire
 * correction**, which is why it is asserted rather than left to review — and why
 * it is a heading rather than an explainer sentence the minimal-copy bound above
 * would (rightly) reject.
 */
describe("Orchestrator launches — a machine-scoped group, labelled as one", () => {
  const row = (over: { on?: boolean; busy?: boolean; onToggle?: (on: boolean) => void } = {}) =>
    agentView({
      orchestrator: { on: false, busy: false, onToggle: noop, ...over },
    });

  it("renders the switch under a label naming the MACHINE scope", () => {
    row();
    expect(screen.getByText("Orchestrator launches")).toBeTruthy();
    // ⚠ The scope statement. If this heading ever goes, the control starts
    // reading as per-channel and the group is a trap.
    expect(screen.getByText("On this Mac, every channel")).toBeTruthy();
  });

  it("is OFF by default and mirrors the stored value", () => {
    const { container } = row();
    expect(
      container.querySelector('[aria-label="Orchestrator launches on this Mac"]')
        ?.getAttribute("aria-checked")
    ).toBe("false");
    cleanup();
    const on = row({ on: true }).container;
    expect(
      on.querySelector('[aria-label="Orchestrator launches on this Mac"]')
        ?.getAttribute("aria-checked")
    ).toBe("true");
  });

  it("reports the operator's intent and writes nothing itself", () => {
    const onToggle = vi.fn();
    row({ onToggle });
    fireEvent.click(
      screen.getByLabelText("Orchestrator launches on this Mac")
    );
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  /** ⚠ A second click landing on top of an unsettled write is the case worth
   *  refusing — this grants a capability, so the last word must be main's. */
  it("goes inert while the write is in flight, and says so", () => {
    const onToggle = vi.fn();
    row({ busy: true, onToggle });
    expect(screen.getByText("Saving…")).toBeTruthy();
    fireEvent.click(
      screen.getByLabelText("Orchestrator launches on this Mac")
    );
    expect(onToggle).not.toHaveBeenCalled();
  });
});
