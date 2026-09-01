"use client";

/**
 * Channels v2 — the SETTINGS tab's AGENT half: the durable launch posture (both
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
 * is two `SelectMenu`s and Tools is a real radiogroup.
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

import { Check } from "lucide-react";
import { useChannelAutoSend } from "../../hooks/use-channel-auto-send";
import { useChannelAgentChain } from "../../hooks/use-channel-agent-chain";
import { useOrchestratorLaunch } from "../../hooks/use-orchestrator-launch";
import {
  AgentChainRows,
  AgentFolderRows,
  AutoSendRows,
  OrchestratorLaunchRows,
} from "./settings-desktop-rows";
import { cn } from "@/shared/lib/utils";
import { AGENT_TOOL_PROFILE_LABELS } from "../../constants";
import { type PermissionPreset } from "../../lib/permission-modes";
import type { RuntimeDescriptor } from "../../lib/runtime-capability";
import { useChannelLaunchPosture } from "../../hooks/use-channel-launch-posture";
import { useChannelFolder } from "../../hooks/use-channel-folder";
import { PanelHeading } from "./bits";
import { usePostureWarning, type PosturePatch } from "./posture-warning";
import { AgentLaunchPostureRows } from "./settings-agent-launch-rows";
import {
  GroupLabel,
  SettingName,
  TOOL_PROFILE_OPTIONS,
} from "./settings-agent-rows";
import type { AgentToolProfile, ChannelMember } from "../../types";

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

export interface ChannelAgentSettingsProps {
  /** The channel's DB UUID — handed to both desktop bridges as-is. */
  channelId: string;
  /** The caller's own tool profile for THIS channel (never a teammate's). */
  profile: AgentToolProfile;
  onSetToolProfile: (profile: AgentToolProfile) => void;
  /** True while the tool-profile write is in flight. */
  toolProfileBusy: boolean;
  /**
   * The channel roster and the caller — the posture warning's third conjunct
   * (`posture-warning.tsx › warrantsPostureWarning`). Read off the roster the
   * host already holds; this surface opens NO read of its own.
   *
   * ⚠ OPTIONAL, AND ABSENT MEANS "THIS MOUNT CANNOT SAY WHO IS HERE" — which
   * warns about nothing, deliberately. A warning naming a peer who might be the
   * operator themselves is what teaches people to click the dialog away. The one
   * production mount (`channel-manage.tsx`) always passes both.
   */
  roster?: readonly ChannelMember[];
  currentUserId?: string | null;
}

/**
 * The bridge-bound half. Split from the view on the rule the deleted
 * `RequestPermissionRow` / `request-folder-row.tsx` pair also followed — they went
 * with the arm (2026-08-20), the rule did not: the view renders (and is asserted
 * on) with no window and no bridge, and this wrapper is the only thing needing one.
 */
export function ChannelAgentSettings(props: ChannelAgentSettingsProps) {
  const launchPosture = useChannelLaunchPosture(props.channelId);
  const folder = useChannelFolder(props.channelId);
  const autoSend = useChannelAutoSend(props.channelId);
  // ⚠ PER CHANNEL, unlike the machine-wide toggle below it (Samuel, 2026-08-31).
  const agentChain = useChannelAgentChain(props.channelId);
  // ⚠ NO `channelId` — this one is per-MACHINE (`use-orchestrator-launch.ts`).
  const orchestrator = useOrchestratorLaunch();

  return (
    <ChannelAgentSettingsView
      profile={props.profile}
      onSetToolProfile={props.onSetToolProfile}
      toolProfileBusy={props.toolProfileBusy}
      roster={props.roster}
      currentUserId={props.currentUserId}
      posture={launchPosture.bridge ? launchPosture.posture : null}
      postureBusy={launchPosture.busy}
      onChangePosture={(patch) => void launchPosture.update(patch)}
      modelSupported={launchPosture.modelSupported}
      runtimeSupported={launchPosture.runtimeSupported}
      runtime={launchPosture.runtime}
      runtimes={launchPosture.runtimes}
      descriptor={launchPosture.descriptor}
      folder={
        folder.bridge
          ? {
              label: folder.label,
              busy: folder.busy,
              onChoose: () => void folder.choose(),
              onClear: () => void folder.clear(),
            }
          : null
      }
      autoSend={
        autoSend.bridge
          ? {
              on: autoSend.on,
              busy: autoSend.busy,
              onToggle: (next) => void autoSend.update(next),
            }
          : null
      }
      agentChain={
        agentChain.bridge
          ? {
              on: agentChain.on,
              busy: agentChain.busy,
              onToggle: (next) => void agentChain.update(next),
            }
          : null
      }
      orchestrator={
        orchestrator.bridge
          ? {
              on: orchestrator.enabled,
              busy: orchestrator.busy,
              onToggle: (next) => void orchestrator.update(next),
            }
          : null
      }
    />
  );
}

/** The desktop-only folder half, or null outside the desktop shell. */
export interface AgentFolderState {
  /** Abbreviated label, or null for the desktop's default folder. ⚠ The bridge
   *  only ever hands back an abbreviation — the absolute path never reaches
   *  this page. */
  label: string | null;
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
  runtimeSupported?: boolean;
  runtime?: string;
  runtimes?: ReadonlyArray<RuntimeDescriptor>;
  descriptor?: RuntimeDescriptor | null;
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
  /** Auto-send (2026-08-20), or null outside the desktop shell (row absent). */
  autoSend?: { on: boolean; busy: boolean; onToggle: (on: boolean) => void } | null;
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
}

export function ChannelAgentSettingsView({
  profile,
  onSetToolProfile,
  toolProfileBusy,
  roster = EMPTY_ROSTER,
  currentUserId = null,
  posture,
  postureBusy,
  onChangePosture,
  modelSupported = false,
  runtimeSupported = false,
  runtime = "",
  runtimes = EMPTY_RUNTIMES,
  descriptor = null,
  folder,
  autoSend = null,
  agentChain = null,
  orchestrator = null,
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
      <PanelHeading title="Agent" />
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
        {posture && (
          <AgentLaunchPostureRows
            posture={posture}
            busy={postureBusy}
            onChange={warning.changePosture}
            modelSupported={modelSupported}
            runtimeSupported={runtimeSupported}
            runtime={runtime}
            runtimes={runtimes}
            descriptor={descriptor}
          />
        )}

        {/* THE DURABLE GROUP. Tools is the containment control, so its options
            keep a few-word line where the posture rows above carry none — no
            hover, no drill-in, and no paragraph either (Samuel, 2026-08-19). */}
        <GroupLabel>For every session on this channel</GroupLabel>
        <SettingName>Tools</SettingName>
        <div
          role="radiogroup"
          aria-label="Tools"
          className="flex flex-col gap-1 pt-0.5"
        >
          {TOOL_PROFILE_OPTIONS.map((option) => {
            const selected = option.value === profile;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={toolProfileBusy}
                onClick={() => {
                  if (!selected) warning.setToolProfile(option.value);
                }}
                className={cn(
                  "flex w-full items-start gap-2 rounded-[10px] border px-2.5 py-2 text-left transition-colors disabled:opacity-60",
                  // ⚠ The resting tint is on the NOT-selected branch: `.raised-tab`
                  // supplies the fill from the kit layer and a utility `bg-*`
                  // would flatten it (docs/DESIGN-SYSTEM.md § `.raised-tab`).
                  selected
                    ? "raised-tab border-transparent"
                    : "border-border-subtle hover:bg-surface-raised-1"
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-body font-medium text-text-primary">
                    {AGENT_TOOL_PROFILE_LABELS[option.value]}
                  </span>
                  <span className="text-caption leading-snug text-text-secondary">
                    {option.description}
                  </span>
                </span>
                {selected && (
                  <Check
                    size={13}
                    aria-hidden
                    className="mt-0.5 shrink-0 text-text-primary"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* The two DESKTOP-ONLY groups — each vanishes whole without its
            bridge (no dead rows); `settings-desktop-rows.tsx` owns both. */}
        {folder && <AgentFolderRows folder={folder} SettingName={SettingName} />}
        {autoSend && <AutoSendRows autoSend={autoSend} SettingName={SettingName} />}
        {/* ⚠ IN THE PER-CHANNEL GROUP, under "For every session on this channel"
            — which is exactly its scope: a session started in this room carries
            the room's chaining stamp. The MACHINE-scoped switch below keeps its
            own heading for the opposite reason. */}
        {agentChain && <AgentChainRows agentChain={agentChain} SettingName={SettingName} />}

        {/* ⚠ THE MACHINE-SCOPED GROUP, LAST AND UNDER ITS OWN LABEL. It is
            deliberately NOT folded into the durable per-channel group above:
            everything there answers "on this channel", this answers "on this
            Mac", and one heading cannot honestly cover both. Same no-dead-rows
            rule — absent whole, heading included, without its own bridge. */}
        {orchestrator && (
          <OrchestratorLaunchRows
            orchestrator={orchestrator}
            GroupLabel={GroupLabel}
          />
        )}
      </div>
      {warning.dialog}
    </>
  );
}

/** ⚠ Module-level, so an unpassed roster is the SAME array every render rather
 *  than a fresh identity the warning would have to re-derive from. */
const EMPTY_ROSTER: readonly ChannelMember[] = [];

/** ⚠ Same rule, and it matters more here: the launch group memoizes nothing off
 *  this list, but a fresh `[]` per render would make every runtime row a new
 *  options identity. A desktop with no adapters and a plain browser share one. */
const EMPTY_RUNTIMES: ReadonlyArray<RuntimeDescriptor> = [];

// ⚠ `LAUNCH_POSTURE_HEADING`, `GroupLabel`, `SettingName`, `SettingRow` AND THE
// `Note` TOMBSTONE MOVED TO `settings-agent-rows.tsx` ON 2026-08-26 — a PURE
// move, no recipe and no string changed. This file was at the 500-line cap and
// the posture warning had to land in it
// (INVARIANTS §1); the row vocabulary is the part with the fewest reasons to
// change, so it is the part that left. `settings-desktop-rows.tsx` still takes
// two of them as props, unchanged.
