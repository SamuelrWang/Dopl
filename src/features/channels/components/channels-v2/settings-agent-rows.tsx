"use client";

/**
 * Channels v2 — the Settings tab's AGENT half: its ROW VOCABULARY, and nothing
 * that reads, writes or decides anything.
 *
 * ⚠ PURE MOVE OUT OF `settings-agent.tsx` (2026-08-26). Not a redesign: every
 * recipe and every string below is the one that file rendered, byte for byte. It
 * moved because that file had reached the 500-line cap (INVARIANTS §1 — "a file
 * at 500 cannot absorb a comment") and the posture warning had to land in it; the
 * three presentational helpers and the one heading string are the part with the
 * fewest reasons to change, so they are the part that leaves.
 *
 * ⚠ THE MINIMAL-COPY RULING LIVES IN `settings-agent.tsx`'s DOCBLOCK AND STILL
 * GOVERNS EVERY ROW BUILT FROM THESE (Samuel, 2026-08-19; INVARIANTS §5): a row
 * on this tab is a NAME and a CONTROL, plus at most a few-word secondary line,
 * and no paragraph-style `text-caption` block anywhere. There is deliberately no
 * recipe here for a third line — see the `Note` tombstone below.
 *
 * ⚠ `settings-desktop-rows.tsx` STILL TAKES `SettingName` / `GroupLabel` AS
 * PROPS, unchanged. They were props because these lived in the host; they could
 * be imports now, but rewiring that is a second change with its own review, and
 * this move is deliberately behaviour-free.
 */

import type { ReactNode } from "react";
import { SelectMenu } from "@/shared/ui/select-menu";
import type { SelectMenuOption } from "@/shared/ui/select-menu";
import { AGENT_TOOL_PROFILE_LABELS } from "../../constants";
import {
  SHARED_CHANNEL_TOOL_CAPTION,
  profileForChannel,
} from "../../lib/tool-profile-resolve";
// ⚠ THE INFO CARD'S HAIRLINE, BY IMPORT (Samuel, 2026-09-13) — see
// {@link SettingDivider}. This file still decides nothing: a separator is a
// rendering concern exactly as the eye is.
import { MetaRowDivider } from "./bits";
// ⚠ 2026-09-06 (item 15). This file is still the ROW VOCABULARY and still decides
// nothing — the eye is a rendering concern like every other recipe here, and its
// COPY lives in `settings-help.tsx` so the table and the components that use it
// change on one clock.
import { SETTINGS_HELP, SettingHelp } from "./settings-help";
import type { AgentToolProfile, ResolvedAgentToolProfile } from "../../types";

/**
 * WHAT EACH TOOL PROFILE MEANS. ⚠ Source of truth is
 * `dopl-desktop-app/main/tool-profiles.js` — read its header before touching a
 * line here. Each rendered line is a claim about CONTAINMENT, so it is bounded
 * by the same rules the long sentences were, at a FIFTH of the length.
 *
 * `full` — no `--tools` bound, no `--allowedTools`, no scoped `--settings`, and
 * specifically NO `--strict-mcp-config`: the operator's OWN connected MCP servers
 * load alongside Dopl's and their global `permissions.allow` keeps applying.
 * That is the PRODUCT. The copy's job is to INFORM, not to warn.
 *
 * `dopl_only` — local read built-ins + WebFetch/WebSearch + NON-ADMIN Dopl tools,
 * pre-approved by name so they work headless. ⚠ Not "full minus danger" — it is
 * not more dangerous than `full` and is a legitimate first choice.
 * `dopl_channel` is excluded AND denied by name, so its reply routes back through
 * the approve-out gate rather than posting itself.
 *
 * `read_only` — local read built-ins only. The whole Dopl MCP server is denied by
 * prefix, and so is the web, so it is the one profile with no outbound channel.
 *
 * ⚠ Do NOT add "and a few destructive tools are always denied" to the `full`
 * line. `UNIVERSAL_HARD_DENY` is exactly the Dopl ADMIN + RETIRED tools, while
 * the SDK lane's `SESSION_HARD_DENY` is BROADER on purpose — so a generalizing
 * sentence is true on one lane and wrong on the other. These describe what each
 * profile GRANTS and promise nothing about what is withheld. That rule survived
 * the shortening: `full` still NAMES the connected apps, and no line ranks a
 * restricted profile as the safe or recommended answer.
 *
 * ⚠ THESE ARE THE ONLY DESCRIPTIONS LEFT ON THE TAB (Samuel, 2026-08-19 —
 * minimal copy). Tools keeps one because it is the CONTAINMENT pick; Permissions
 * and Sends render their option labels alone and keep their per-option
 * descriptions inside the `SelectMenu` dropdown, where a person reads them while
 * choosing. **≤5 words each, no trailing period.** The full sentences these
 * replaced are directly above — as a comment, deliberately.
 *
 * ⚠ SECOND PURE MOVE OUT OF `settings-agent.tsx` (2026-08-31), on the 2026-08-26
 * move's exact argument and for the same reason: that file was at 496 of the 500
 * cap and the agent-chaining switch (Samuel's ruling that day) had to land in it.
 * Not one character of the table or its docblock changed. It belongs here for the
 * reason the row vocabulary does — it is a rendering constant with no reader,
 * writer or decision in it.
 */
export const TOOL_PROFILE_OPTIONS: ReadonlyArray<{
  value: AgentToolProfile;
  description: string;
}> = [
  { value: "full", description: "Everything, including connected apps" },
  { value: "dopl_only", description: "Files, web, and Dopl" },
  { value: "read_only", description: "Local files only" },
];

/**
 * The heading over the launch posture. ⚠ IT NAMES THE ACT, NOT A TIME WINDOW.
 * The deleted arm's heading ("For the next request you allow") was doing the whole
 * job of saying "this is single-use" and could not carry it; this pair really is
 * durable, so the honest sentence is the one that says WHICH launches it governs
 * — the ones the operator starts. It must never read "for every session": an
 * inbound request a peer triggered carries no tool posture and starts at manual/ask.
 */
export const LAUNCH_POSTURE_HEADING = "When you launch an agent";

/** The sub-heading that separates each group. ⚠ Every group on this tab is
 *  DURABLE — nothing single-use is left anywhere in the product — so the headings
 *  say what each one GOVERNS rather than how long it lasts. A heading naming a
 *  time window is the regression (`use-channel-launch-posture.ts`).
 *
 *  ⚠ **NOTHING CALLS IT SINCE 2026-09-13** (Samuel: *"also remove the header line
 *  Agents"*) — `settings-channel-agents.tsx` was the last caller, and 2026-09-06
 *  (item 2) had already deleted the other three. The recipe stays exported on
 *  {@link SettingName}'s terms: what separates groups on this tab now is
 *  {@link SettingDivider}, and a group heading put back here would be re-opening a
 *  ruling rather than reusing a helper. */
export function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="pt-1.5 text-label font-semibold uppercase tracking-wide text-text-secondary">
      {children}
    </p>
  );
}

/**
 * THE HAIRLINE BETWEEN TWO SETTING ROWS (Samuel, 2026-09-13): *"in the settings tab
 * for channels and threads. In between each setting, add a horizontal line, like how
 * we have in the channel info area."*
 *
 * ⚠ IT IS THE INFO CARD'S OWN LINE, BY IMPORT — `bits.tsx › MetaRowDivider`, the
 * recipe the Info tab puts between its `MetaRow`s. He named that surface as the
 * reference, so a second `border-t` cut by hand here would be the same line at a
 * different inset the first time either moved.
 *
 * ⚠ EVERY ROW CARRIES ITS OWN LEADING LINE, AND `first:hidden` IS WHAT KEEPS IT OFF
 * THE TOP OF A GROUP. Rows on this tab are CONDITIONAL — Runtime only with a runtime
 * bridge, Model only on a main that has the field, the secondary tool axis only for
 * runtimes that declare one — so which row is FIRST is a render-time fact. A static
 * "I am first" flag would be wrong on exactly the desktops that render fewest rows;
 * `:first-child` is right on all of them, and it needs no caller to remember anything.
 *
 * ⚠ `always` IS FOR A GROUP THAT CONTINUES THE COLUMN ABOVE IT — the responder row
 * (`settings-channel-agents.tsx`), which is the first row of its own container but
 * NOT the first setting a reader sees. Its "AGENTS" heading used to be the break
 * there; the heading is deleted (same ruling), so the line is.
 */
export function SettingDivider({ always = false }: { always?: boolean } = {}) {
  return (
    <div data-settings-divider className={always ? undefined : "first:hidden"}>
      <MetaRowDivider />
    </div>
  );
}

/** A setting's NAME — primary ink, because it is the thing being set. */
export function SettingName({ children }: { children: ReactNode }) {
  return (
    <p className="pt-1.5 text-body font-medium text-text-primary">{children}</p>
  );
}

// ⚠ `Note` STOOD IN `settings-agent.tsx` AND IS DELETED (2026-08-22). It was the
// tab's one secondary-line recipe and its only two callers were trust's SCOPE
// hint and the empty-roster line, both of which went with the "Always allow"
// section. The minimal-copy ruling (INVARIANTS §5) stands: a row on this tab is a
// NAME + a CONTROL, and there is now no recipe here to hang a third sentence off.

/**
 * A named setting with its control on the right. The 380px panel (2026-08-25) is why the
 * control sits beside the name rather than under it: a `SelectMenu` pill is
 * ~120px and the name ~80px, so one line holds both and the column stays
 * scannable.
 */
export function SettingRow({
  name,
  children,
  continues = false,
}: {
  name: string;
  children: ReactNode;
  /** This row CONTINUES the column above it, so its hairline shows even though it
   *  is the first child of its own container — see {@link SettingDivider}. */
  continues?: boolean;
}) {
  // ⚠ THE EYE IS LOOKED UP, NOT PASSED (2026-09-06, item 15). Keying on the row's
  // own rendered NAME means every row built from this recipe gets its explanation
  // for free and a renamed row loses its eye VISIBLY — an omission you can see —
  // rather than keeping a stale sentence under a new label. A row with no entry
  // renders no eye at all, which is the same no-dead-rows direction this tab takes
  // everywhere else.
  const help = SETTINGS_HELP[name];
  return (
    <>
      {/* ⚠ THE LINE BELONGS TO THE ROW, NOT TO THE CONTAINER (Samuel, 2026-09-13).
          Every setting row on both faces is built from this recipe, so a row added
          later — or a row a bridge turns on — arrives separated without its author
          doing anything. Interleaving in the containers instead would have missed the
          launch group entirely: those four rows are one child of one container. */}
      <SettingDivider always={continues} />
      <div data-settings-row className="flex min-h-[32px] items-center gap-2">
        <span className="flex shrink-0 items-center gap-1">
          {/* ⚠ REGULAR WEIGHT, NOT `font-medium` (Samuel, 2026-09-10): "unbold these
              things — Runtime Default, Tool use Bypass, Messaging Automatic, Model
              Sonnet 5, Tool access Full access, Working Folder ~/Downloads, Launch
              agents In every channel." The NAME and the VALUE are one vocabulary, so
              the weight left both halves on the same clock — `select-menu.tsx ›
              TRIGGER_FACE.text` is the value half. The heading over the block
              (`PanelHeading`) and the `GroupLabel`s are NOT in that list and keep
              theirs. */}
          <span className="text-body text-text-primary">{name}</span>
          {/* ⚠ BESIDE THE NAME, NOT FLOATED OVER THE ROW. Samuel asked for "a little
              eye in the top right of it" — of the ITEM. These rows are ONE LINE
              (`settings-agent-rows.tsx › SettingRow`: the 380px panel is why the
              control sits beside the name), so the item's own top-right IS the end of
              its label; floating it against the row's right rail would put it on top
              of the control instead. */}
          {help && <SettingHelp name={name} copy={help} />}
        </span>
        <span className="flex min-w-0 flex-1 justify-end">{children}</span>
      </div>
    </>
  );
}

/**
 * "TOOL ACCESS" — the containment pick, and **the RESOLVED profile beside it**
 * (2026-09-13, F-692).
 *
 * ⚠ **THE BUG IT FIXES IS A LABEL THAT LIED.** The `SelectMenu` rendered the STORED
 * value's label, so a shared channel storing `full` printed "Full access" over a
 * session the desktop launches at `channel_agent` — `full` minus the shell (ruling
 * B7, and `main/targeting-window.js › resolveLaunchToolProfile` is the lane every
 * launch goes through). `constants.ts › UNRESOLVED_TOOL_PROFILE` already states why
 * that is a defect and not a nicety: a profile label is a CONTAINMENT CLAIM.
 *
 * ⚠ **THE VALUE WRITTEN IS STILL THE STORED ENUM, AND ONLY THE LABEL MOVES.** The
 * option's `value` stays `full`, so this control offers exactly the three values the
 * column accepts; what changes is the WORDS on the option the resolution lands on.
 * Adding `channel_agent` as a fourth option would offer a write the column's CHECK
 * rejects — see `types.ts › ResolvedAgentToolProfile`.
 *
 * ⚠ **IT IS DERIVED FROM `TOOL_PROFILE_OPTIONS`, NEVER RE-LISTED**, and the label
 * half from `AGENT_TOOL_PROFILE_LABELS` — the rule the table above it already
 * follows, and it matters more here because the thing that would drift is a claim
 * about what a session may do.
 *
 * ⚠ **THE CAPTION IS SIX WORDS AND APPEARS ONLY WHEN THE RESOLUTION MOVED.** The
 * minimal-copy ruling (Samuel, 2026-08-19; INVARIANTS §5) allows a row a few-word
 * secondary line; a caption on every row would be the explainer paragraph that
 * ruling deleted.
 */
/**
 * "TOOL ACCESS" AS `SelectMenu` OPTIONS, AT THE STORED LABELS.
 *
 * ⚠ **DERIVED FROM `TOOL_PROFILE_OPTIONS`, NEVER RE-LISTED** — that table is the one place the
 * three profiles and their containment lines live, and its docblock is the review that bought
 * each line's wording. A second list here would be the two-readers-one-fact defect with a
 * CONTAINMENT CLAIM as the thing that drifts. The LABEL half is `AGENT_TOOL_PROFILE_LABELS`.
 * ⚠ **MODULE LEVEL**, so an unnarrowed row hands the menu the same array on every render.
 */
const TOOL_ACCESS_OPTIONS: ReadonlyArray<SelectMenuOption<AgentToolProfile>> =
  TOOL_PROFILE_OPTIONS.map((option) => ({
    value: option.value,
    label: AGENT_TOOL_PROFILE_LABELS[option.value],
    description: option.description,
  }));

/** The same list with the SELECTED option wearing the RESOLVED profile's words. ⚠ ONLY the
 *  option the resolution lands on is relabelled — relabelling every one would claim the
 *  narrowing applies to picks the operator has not made. */
function relabelled(
  profile: AgentToolProfile,
  resolved: ResolvedAgentToolProfile
): ReadonlyArray<SelectMenuOption<AgentToolProfile>> {
  return TOOL_ACCESS_OPTIONS.map((option) =>
    option.value === profile
      ? { ...option, label: AGENT_TOOL_PROFILE_LABELS[resolved] }
      : option
  );
}

export function ToolAccessRow({
  profile,
  shared,
  busy,
  onChange,
}: {
  /** The caller's STORED value for this channel — what the control writes. */
  profile: AgentToolProfile;
  /**
   * Is this room shared? `lib/tool-profile-resolve.ts › isSharedChannel` over the
   * channel's own member count. ⚠ An unknown count reads as SHARED there, because
   * the only thing the answer can do is remove the shell.
   */
  shared: boolean;
  busy: boolean;
  onChange: (next: AgentToolProfile) => void;
}) {
  const resolved = profileForChannel(profile, shared);
  const narrowed = resolved !== profile;
  // ⚠ **THE STORED LIST IS ONE IDENTITY FOR EVERY RENDER, AND ONLY A NARROWED ROW PAYS FOR A
  // NEW ONE** (2026-09-14). The docblock this row inherited from `settings-agent.tsx` argued
  // MODULE LEVEL — *"so the options are one identity for every render … it matters more here
  // because the value is compared against the list on each open"* — and the move to a
  // per-render `map` dropped that without retiring the argument. The labels only move when the
  // resolution moves, which is the shared-channel case alone, so the ordinary room reads the
  // module constant and nothing is rebuilt behind a menu that is open.
  const options = narrowed ? relabelled(profile, resolved) : TOOL_ACCESS_OPTIONS;
  return (
    <>
      <SettingRow name="Tool access">
        <SelectMenu<AgentToolProfile>
          variant="text"
          value={profile}
          options={options}
          onChange={(next) => {
            if (next !== profile) onChange(next);
          }}
          ariaLabel="Tool access for agents on this channel"
          disabled={busy}
        />
      </SettingRow>
      {narrowed && (
        <p className="text-caption text-text-secondary">
          {SHARED_CHANNEL_TOOL_CAPTION}
        </p>
      )}
    </>
  );
}
