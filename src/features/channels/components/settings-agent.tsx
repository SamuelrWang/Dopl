"use client";

/**
 * Channels — the SETTINGS tab's AGENT half: the durable launch posture (both
 * permission axes and, since 2026-08-22, the MODEL), the durable per-channel tool
 * profile, and the desktop-only working folder and auto-send rows. All of it
 * INLINE, and all of it DURABLE.
 *
 * ⚠ THE TRUST ROSTER IS DELETED (Samuel, 2026-08-22). "Always allow <teammate>"
 * was standing consent for an INBOUND ask — it pre-approved the decision the same
 * ruling just retired everywhere ("remove all the stuff about declining and
 * approving of threads"), so it governed nothing. It never fired once.
 * `use-trust-rules.ts`, the `trust` mutation, its optimistic cache patch and the
 * `/api/channels/trust` client path all went with it; the table and its two
 * routes are being deleted server-side in the same wave.
 *
 * ⚠ THE PERMISSION ARM IS DELETED, NOT REHOMED (2026-08-20, Samuel's ruling). It
 * lived here, and being here is what broke it: a single-use, 30-minute fuse among
 * four durable settings reads as a fifth one, so the operator picked Bypass, the
 * first approved launch spent it, and this control went on displaying "Bypass".
 * It was first said to have "gone back to the request card" — that card's inbound
 * branch had not rendered since 2026-08-18 (F-233), so `RequestPermissionRow`,
 * `request-folder-row.tsx` and `channelPermissionPresets` all went the same day.
 * The two selects below write the DURABLE posture, now the ONLY permission
 * posture in the product; the view's comment below is the full account.
 *
 * ⚠ THIS FILE IS THE 2026-08-19 RULING (Samuel, live review) AND IT REPLACED TWO
 * POPOVERS. `components/channel-settings-popover.tsx` (a 7×7 icon button opening
 * a `role="menu"` panel that drilled into three `OptionPanel`s) and
 * `components/channel-folder-control.tsx` (a second 7×7 icon button over a third
 * popover) were **DELETED**, not re-hosted: the complaint was that every setting
 * on this surface was behind a click, and a drill-down inside a tab is a menu
 * hiding inside a menu. **Every control below is visible and operable where it
 * sits.** INVARIANTS §5 records the ruling; the open "product fate" question it
 * used to record is closed by this file.
 *
 * ⚠ NO NEW WRITES, NO NEW PATHS — as of the 2026-08-19 inlining, which is what
 * that ruling was about. (The 2026-08-20 split above DID change one: these two
 * selects moved from the arm's bridge ops to the posture's. Nothing else here
 * did.) The folder is still {@link useChannelFolder}, and the tool profile still
 * calls back into `channel-manage.tsx`'s mutation on the page's ONE `gate`.
 *
 * ⚠ NO DEAD ROWS (INVARIANTS §5). Both desktop-only groups are gated on their
 * own bridge, so a plain browser renders neither the controls NOR a heading over
 * nothing.
 *
 * ⚠ NO `role="menu"` IDIOMS. The old panel used checked menu items for
 * everything because a menu may only own menu items; inline, the launch posture
 * is two `SelectMenu`s, and Tool access became a third on 2026-09-06 (item 6) —
 * it was a real radiogroup until then, which was the right answer while its three
 * options stood on the tab carrying a containment line each.
 *
 * ⚠ MINIMAL COPY — SAMUEL, 2026-08-19 (third ruling of the day, and it
 * SUPERSEDES the explain-it-in-the-UI half of the two above). The first inline
 * pass carried an explainer paragraph under almost every control — the arm's
 * lifetime, the durable note, the folder note, two sentences of trust scope (the
 * trust section is itself gone now), and a full sentence per tool profile. **"We should not be explaining everything to
 * the user."** They are all gone. The rule for this tab now: a row is a NAME + a
 * CONTROL, plus at most a few-word secondary line; **no paragraph-style
 * `text-caption` block anywhere.** It is a settings panel, not documentation.
 *
 * ⚠ WHAT THE COPY SAID DID NOT STOP BEING TRUE — it stopped being RENDERED. The
 * meanings live on in the docblocks below, which are for DEVELOPERS. Do not read
 * a deleted sentence as a changed behaviour, and do not put one back on the
 * surface to "restore" a rule.
 *
 * ⚠ AND THE ONE WARNING THIS TAB OWES IS A DIALOG, NOT AN EXCEPTION TO THAT RULE
 * (Samuel, 2026-08-26). `auto_both` + `full` + a peer on the roster is the one
 * combination worth stopping a human over, and it is `posture-warning.tsx` — a
 * `ConfirmDialog` fired at the MOMENT OF SETTING, on the TRANSITION INTO the
 * combination, naming who receives. It is not a standing banner and must never
 * become one; both writes below route through {@link usePostureWarning}, because
 * either axis can be the flip.
 */

// ⚠ `Check` / `cn` LEFT WITH THE RADIOGROUP (2026-09-06, item 6). The selected
// state is the `SelectMenu`'s own now, so this file draws no tick and composes no
// conditional class; an import kept "in case" is how a deleted recipe comes back.
// ⚠ THE `SelectMenu` IMPORT LEFT WITH `TOOL_ACCESS_OPTIONS` ON 2026-09-13 (F-692):
// this file composes no control of its own any more — `settings-agent-launch-rows.tsx`
// owns the launch group's menus and `settings-agent-rows.tsx › ToolAccessRow` owns
// Tool access. Nothing here renders a dropdown, so nothing here imports one.
// ⚠ `useChannelAutoSend` IS NO LONGER READ HERE (2026-09-06, item 8) — the hook file
// still exists and is next in the teardown, but nothing on this tab may keep reading
// a record the gate has stopped consulting.
// ⚠ A SEPARATE GRANT, NEVER A SECOND SPELLING OF THE LAUNCH ONE (2026-09-16) —
// `hooks/use-orchestrator-direct.ts` carries the ruling and what it cost.
// ⚠ THREE ROW COMPONENTS BECAME ONE (2026-09-06, items 8 and 9). `AutoSendRows`,
// `AgentChainRows` and `OrchestratorLaunchRows` are deleted; `LaunchAgentsRow` is the
// single control over the two launch records. `settings-desktop-rows.tsx` carries the
// tombstone for each.
import { AgentFolderRows, DirectAgentsRow, LaunchAgentsRow } from "./settings-desktop-rows";
import { isSharedChannel } from "../lib/tool-profile-resolve";
import { type PermissionPreset } from "../lib/permission-modes";
import type { LaunchSelectionState } from "../hooks/use-launch-selection";
import { PanelHeading } from "./bits";
import { usePostureWarning, type PosturePatch } from "./posture-warning";
// ⚠ **THE BRIDGE-BOUND CONTAINER LIVES IN `settings-agent-container.tsx` (§1 split, U8)** and is
// re-exported here, so no caller and no suite moved. That file changes when a RECORD changes;
// this one when a ROW does. ⚠ A `import type` would not do — the name is a COMPONENT callers
// mount.
export { ChannelAgentSettings } from "./settings-agent-container";
export type { ChannelAgentSettingsProps } from "./settings-agent-container";
import { AgentLaunchPostureRows } from "./settings-agent-launch-rows";
// ⚠ `GroupLabel` IS NO LONGER IMPORTED (2026-09-06, item 2): all three group
// headings on this tab are deleted, so nothing here renders one. The RECIPE stays
// exported from `settings-agent-rows.tsx` — `settings-channel-agents.tsx` still uses
// it — and only this tab stopped calling it.
// ⚠ `SettingName` IS NO LONGER IMPORTED (2026-09-06). It was the standalone-name
// recipe for the three rows whose control sat UNDER the name; every row on this tab
// is a one-line `SettingRow` now, so nothing renders a bare name. The recipe stays
// exported — it is not this tab's to delete.
import { ToolAccessRow } from "./settings-agent-rows";
import type { AgentToolProfile, ChannelMember } from "../types";

// ⚠ `TOOL_PROFILE_OPTIONS` AND ITS DOCBLOCK MOVED TO `settings-agent-rows.tsx` ON
// 2026-08-31 — a PURE move, on the 2026-08-26 row-vocabulary move's exact
// argument: this file was at 496 of the 500-line cap (INVARIANTS §1) and the
// agent-chaining switch had to land in it. Not one character changed.

// ⚠ THE "ALWAYS ALLOW" SECTION STOOD HERE AND IS DELETED (Samuel, 2026-08-22).
// `TRUST_SCOPE_HINT`, `TRUST_EMPTY_COPY`, the `TrustRow` switch, the
// `trustedIds` / `trustBusyIds` props and the `useTrustRules` read behind them
// went with the INBOUND consent lane they were the standing-consent shortcut FOR
// — a rule that pre-approves an ask nobody is asked any more. It never fired
// once in production. `agent_trust_rules` and its two routes are being deleted
// server-side in the same wave.

/** The desktop-only folder half, or null outside the desktop shell. */
export interface AgentFolderState {
  /** THE EFFECTIVE working directory, abbreviated — where this channel's agent
   *  actually runs, null only before the first answer lands. ⚠ The bridge only
   *  ever hands back an abbreviation — the absolute path never reaches this page.
   *  ⚠ It no longer doubles as "is a custom folder set"; that is `custom`, and the
   *  conflation is what had this row printing "Sandbox (default)" over the null. */
  label: string | null;
  /** A per-channel folder is set. Gates the reset control, and nothing else. */
  custom: boolean;
  /** True while the native picker (or a reset) is in flight. */
  busy: boolean;
  onChoose: () => void;
  onClear: () => void;
}

export interface ChannelAgentSettingsViewProps {
  profile: AgentToolProfile;
  onSetToolProfile: (profile: AgentToolProfile) => void;
  /** True while the tool-profile write is in flight — the options go inert. It
   *  is the DURABLE containment control, so a second pick landing on top of an
   *  unsettled one is the case worth refusing. */
  toolProfileBusy: boolean;
  /** The posture warning's third conjunct — see `ChannelAgentSettingsProps`,
   *  which states why both are optional and what an absent one means. */
  roster?: readonly ChannelMember[];
  currentUserId?: string | null;
  /** The channel's own member count — see `ChannelAgentSettingsProps.memberCount`
   *  for why it is the count and not the roster's length, and why absent reads as
   *  SHARED. */
  memberCount?: number | null;
  /** The DURABLE launch posture, or null outside the desktop shell (subsection
   *  absent). ⚠ NOT the arm — `use-channel-launch-posture.ts` says why they are
   *  two records with two consumers. */
  posture: PermissionPreset | null;
  /** True while a posture write is in flight — every posture select goes inert. */
  postureBusy: boolean;
  onChangePosture: (patch: PosturePatch) => void;
  /**
   * THE RUNTIME FAMILY (2026-08-31, the runtime-adapter port) — the channel's
   * pick, every adapter this desktop registered, and the descriptor a launch
   * here would use. `settings-agent-launch-rows.tsx` is where all four are read
   * and where the §3.1/§3.2 rules over them are stated.
   *
   * ⚠ `runtimeSupported` IS A SEPARATE GATE FROM `posture` BEING NON-NULL, for
   * `modelSupported`'s reason: the two axes exist on desktops the runtime does
   * not, and false renders NO runtime row rather than a greyed one.
   */
  selection?: LaunchSelectionState | null;
  /**
   * This desktop understands the posture record's `model` field (2026-08-22).
   *
   * ⚠ FALSE RENDERS NO MODEL ROW — the no-dead-rows rule (INVARIANTS §5), and
   * here it is worse than a dead row would normally be: an older main DROPS the
   * field, so the pick would appear to save and every launch would ignore it.
   * ⚠ It is a SEPARATE gate from `posture` being non-null, because the two axes
   * exist on builds the model does not. `use-channel-launch-posture.ts ›
   * ChannelLaunchPostureState.modelSupported` is where it is probed.
   */
  modelSupported?: boolean;
  /** The working folder, or null outside the desktop shell (row absent). */
  folder: AgentFolderState | null;
  // ⚠ `autoSend` IS DELETED FROM THIS CONTRACT (2026-09-06, item 8). It was the
  // Replies row's bridge; the row is gone and `effectiveMessageMode` reads Messaging
  // instead. A prop kept for shape would be a value this view could render nothing
  // with.
  /**
   * AGENT CHAINING (Samuel, 2026-08-31), or null outside the desktop shell (row
   * absent — the no-dead-rows rule). ⚠ PER CHANNEL, unlike `orchestrator` below:
   * it says whether an agent launched IN THIS ROOM may launch further agents.
   * Default OFF is the one-generation bound that shipped, so an older main
   * without the bridge renders nothing and changes nothing.
   */
  agentChain?: { on: boolean; busy: boolean; onToggle: (on: boolean) => void } | null;
  /**
   * ORCHESTRATOR LAUNCHES (2026-08-22), or null without the bridge (group
   * absent, heading included). ⚠ **THE ONLY PER-MACHINE CONTROL ON THIS TAB** —
   * no `channelId` anywhere in its chain; the scope argument is
   * `hooks/use-orchestrator-launch.ts` and the label that carries it is
   * `settings-desktop-rows.tsx › OrchestratorLaunchRows`.
   * ⚠ A SEPARATE gate from `folder` / `autoSend`: those probe `dopl.channels`,
   * this probes `dopl.orchestratorLaunch`, and a main with one and not the
   * other is the ordinary shape while this ships.
   */
  orchestrator?: {
    on: boolean;
    busy: boolean;
    onToggle: (on: boolean) => void;
  } | null;
  /** DIRECT AGENTS (Samuel, 2026-09-16), or null without the bridge (row absent).
   *  ⚠ PER-MACHINE like `orchestrator` and a SEPARATE record from it, on a THIRD
   *  bridge member. `settings-desktop-rows.tsx › DirectAgentsRow` has the why. */
  orchestratorDirect?: {
    on: boolean;
    busy: boolean;
    onToggle: (on: boolean) => void;
  } | null;
}

export function ChannelAgentSettingsView({
  profile,
  onSetToolProfile,
  toolProfileBusy,
  roster = EMPTY_ROSTER,
  currentUserId = null,
  memberCount = null,
  posture,
  onChangePosture,
  selection = null,
  folder,
  agentChain = null,
  orchestrator = null,
  orchestratorDirect = null,
}: ChannelAgentSettingsViewProps) {
  // ⚠ BOTH WRITES GO THROUGH THE WARNING, never around it — either axis can be
  // the flip into `auto_both` + `full` + a peer. `posture-warning.tsx` holds the
  // predicate, the copy and the dialog, and commits the ORIGINAL write on
  // confirm; cancel writes nothing at all.
  const warning = usePostureWarning({
    messageMode: posture?.messages ?? null,
    toolProfile: profile,
    roster,
    currentUserId,
    commitPosture: onChangePosture,
    commitToolProfile: onSetToolProfile,
  });

  return (
    <>
      {/* ⚠ "Agent" → "Agent Settings" (2026-09-06, item 1). The tab is reached from
          an Agents surface, so the bare noun read as a label for the AGENT rather
          than for what this panel does. */}
      <PanelHeading title="Agent Settings" />
      <div className="flex flex-col gap-1 px-3.5">
        {/* THE DURABLE LAUNCH POSTURE — the runtime, both permission axes and
            the model, as ONE group. Absent entirely in a plain browser: no
            bridge, no dead rows.

            ⚠ THE GROUP AND ITS WHOLE ARGUMENT MOVED TO
            `settings-agent-launch-rows.tsx` ON 2026-08-31, with the runtime-adapter
            port. Not a redesign of what it stores: the seam is that Axis A is now
            rendered from `descriptor.toolMode.options` — the RUNTIME row decides the
            vocabulary of the row under it — so the two cannot live in different
            files without drifting. This file was at the 500-line cap (INVARIANTS §1)
            and could not have absorbed either the runtime row or the reasons for it.
            ⚠ BOTH WRITES STILL GO THROUGH THE WARNING, unchanged: `changePosture`
            is what the group is handed, so the `auto_both` + `full` + a-peer dialog
            fires on exactly the transitions it always did. */}
        {posture && selection && (
          <AgentLaunchPostureRows
            selection={selection}
            // ⚠ THE MESSAGING WRITE IS THE ONLY ONE THAT GOES THROUGH THE WARNING, and that is
            // narrower than before rather than looser: `usePostureWarning › changePosture` reads
            // ONLY `patch.messages`, so the runtime, model, effort, tool-use and sandbox writes
            // it used to carry could never open (or suppress) the dialog. They now reach the
            // record directly, and the `auto_both` + `full` + a-peer dialog fires on exactly the
            // transitions it always did.
            onChangeMessages={warning.changePosture}
          />
        )}

        {/* ⚠ THE "For every session on this channel" GROUP LABEL IS DELETED
            (2026-09-06, item 2). Its scope statement did not stop being true — it
            stopped being RENDERED, exactly as `LAUNCH_POSTURE_HEADING` did. The
            per-row eye popover carries it now.

            ⚠ AND TOOLS IS A DROPDOWN NAMED "Tool access" (item 6). It was a
            three-option `role="radiogroup"` whose options each carried a
            few-word containment line — the ONLY descriptions left on this tab
            after the 2026-08-19 minimal-copy ruling. Those lines are NOT lost:
            they ride `TOOL_PROFILE_OPTIONS.description` into the `SelectMenu`
            dropdown, which is where this tab already keeps per-option copy
            ("where a person reads them while choosing"), and the eye popover
            carries the same words for a reader who is not choosing.
            ⚠ IT STILL ROUTES THROUGH THE POSTURE WARNING. `warning.setToolProfile`
            is the commit, unchanged: `full` is one half of the `auto_both` + `full`
            + a-peer dialog, and a control that wrote around it would delete the one
            warning this tab owes. */}
        {/* ⚠ THE ROW MOVED TO `settings-agent-rows.tsx › ToolAccessRow` ON
            2026-09-13 (F-692), and it took `TOOL_ACCESS_OPTIONS` with it. Not a
            redesign: the control, the aria-label and the write are the same, and
            the write still routes through `warning.setToolProfile`. What the row
            gained is the RESOLVED profile — a shared channel storing `full`
            printed "Full access" over a session the desktop runs at
            `channel_agent`, which is the fail-open containment claim
            `constants.ts › UNRESOLVED_TOOL_PROFILE` is written against. It is in
            the row vocabulary because the label and its caption are rendering
            facts, and because this file is 30 lines under the cap. */}
        <ToolAccessRow
          profile={profile}
          shared={isSharedChannel(memberCount)}
          busy={toolProfileBusy}
          onChange={warning.setToolProfile}
        />

        {/* The two DESKTOP-ONLY groups — each vanishes whole without its
            bridge (no dead rows); `settings-desktop-rows.tsx` owns both. */}
        {folder && <AgentFolderRows folder={folder} />}
        {/* ⚠ THE "Replies / Send automatically" ROW IS DELETED (2026-09-06, item 8).
            It set the SAME axis as Messaging and disagreed with it by construction —
            Messaging was frozen at launch, this was read live at the gate, and it
            FORCED the out half on over whatever Messaging said. `Messaging` is now
            the one control and `main/session-private.js › effectiveMessageMode` is
            still the one gate read, sourced from it and still LIVE, so the property
            that mattered ("it applies to every agent in this channel immediately")
            is preserved exactly. The popover for Messaging states the asymmetry.
            ⚠ THE RECORD AND ITS WHOLE BRIDGE ARE TORN DOWN TOO (same change):
            `useChannelAutoSend` is a tombstone, `channel-prefs.getAutoSend` /
            `setAutoSend`, the two `channels:*AutoSend` IPC handlers, their preload
            methods and their `dopl-bridge.ts` declarations are deleted, and their
            rows left `test/_ipc-ops-table.mjs`. Nothing reads the old key; rows left
            on disk are inert by design — see the hook's tombstone for why they are
            deliberately NOT migrated. */}
        {/* ⚠ ONE ROW OVER BOTH LAUNCH RECORDS (item 9). It needs BOTH bridges and
            renders without neither: a dropdown that could set only one of the two
            would offer picks that silently do half of what they say — worse than the
            no-dead-rows rule it would otherwise satisfy. The two records stay
            separate underneath (per-channel chaining, per-machine orchestrator);
            `settings-desktop-rows.tsx › LaunchAgentsRow` is the only place the
            mapping between them and the three picks is written. */}
        {agentChain && orchestrator && (
          <LaunchAgentsRow agentChain={agentChain} orchestrator={orchestrator} />
        )}
        {/* ⚠ IT RENDERS EVEN WHEN THE LAUNCH ROW ABOVE DOES NOT — the two consents are
            independent, and gating this on the launch bridges would hide the control
            for a lane that is armed: the failure this row exists to end. */}
        {orchestratorDirect && (
          <DirectAgentsRow orchestratorDirect={orchestratorDirect} />
        )}
      </div>
      {warning.dialog}
    </>
  );
}

// ⚠ `TOOL_ACCESS_OPTIONS` STOOD HERE AND MOVED TO `settings-agent-rows.tsx ›
// ToolAccessRow` ON 2026-09-13 (F-692), for the reason the row vocabulary lives
// there at all: it is derived from `TOOL_PROFILE_OPTIONS` and
// `AGENT_TOOL_PROFILE_LABELS`, and the label half now depends on the RESOLVED
// profile — so the list and the row that renders it must change on one clock. The
// "derived, never re-listed" rule its docblock carried moved with it verbatim.

/** ⚠ Module-level, so an unpassed roster is the SAME array every render rather
 *  than a fresh identity the warning would have to re-derive from. */
const EMPTY_ROSTER: readonly ChannelMember[] = [];

/** ⚠ Same rule, and it matters more here: the launch group memoizes nothing off
 *  this list, but a fresh `[]` per render would make every runtime row a new
 *  options identity. A desktop with no adapters and a plain browser share one. */

// ⚠ `LAUNCH_POSTURE_HEADING`, `GroupLabel`, `SettingName`, `SettingRow` AND THE
// `Note` TOMBSTONE MOVED TO `settings-agent-rows.tsx` ON 2026-08-26 — a PURE
// move, no recipe and no string changed. This file was at the 500-line cap and
// the posture warning had to land in it
// (INVARIANTS §1); the row vocabulary is the part with the fewest reasons to
// change, so it is the part that left. `settings-desktop-rows.tsx` still takes
// two of them as props, unchanged.
