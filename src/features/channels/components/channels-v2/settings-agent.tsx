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
 */

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { SelectMenu } from "@/shared/ui/select-menu";
import { useChannelAutoSend } from "../../hooks/use-channel-auto-send";
import { AgentFolderRows, AutoSendRows } from "./settings-desktop-rows";
import { cn } from "@/shared/lib/utils";
import { AGENT_TOOL_PROFILE_LABELS } from "../../constants";
import {
  type MessageMode,
  type PermissionPreset,
  type ToolMode,
} from "../../lib/permission-modes";
import { useChannelLaunchPosture } from "../../hooks/use-channel-launch-posture";
import { useChannelFolder } from "../../hooks/use-channel-folder";
import { MESSAGE_OPTIONS, TOOL_OPTIONS } from "../permission-preset-row";
import {
  AGENT_MODEL_DEFAULT,
  AGENT_MODEL_OPTIONS,
} from "../../lib/agent-models";
import { PanelHeading } from "./bits";
import type { AgentToolProfile } from "../../types";

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
 */
const TOOL_PROFILE_OPTIONS: ReadonlyArray<{
  value: AgentToolProfile;
  description: string;
}> = [
  { value: "full", description: "Everything, including connected apps" },
  { value: "dopl_only", description: "Files, web, and Dopl" },
  { value: "read_only", description: "Local files only" },
];

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

  return (
    <ChannelAgentSettingsView
      profile={props.profile}
      onSetToolProfile={props.onSetToolProfile}
      toolProfileBusy={props.toolProfileBusy}
      posture={launchPosture.bridge ? launchPosture.posture : null}
      postureBusy={launchPosture.busy}
      onChangePosture={(patch) => void launchPosture.update(patch)}
      modelSupported={launchPosture.modelSupported}
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
  /** The DURABLE launch posture, or null outside the desktop shell (subsection
   *  absent). ⚠ NOT the arm — `use-channel-launch-posture.ts` says why they are
   *  two records with two consumers. */
  posture: PermissionPreset | null;
  /** True while a posture write is in flight — every posture select goes inert. */
  postureBusy: boolean;
  onChangePosture: (patch: Partial<PermissionPreset>) => void;
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
}

export function ChannelAgentSettingsView({
  profile,
  onSetToolProfile,
  toolProfileBusy,
  posture,
  postureBusy,
  onChangePosture,
  modelSupported = false,
  folder,
  autoSend = null,
}: ChannelAgentSettingsViewProps) {
  return (
    <>
      <PanelHeading title="Agent" />
      <div className="flex flex-col gap-1 px-3.5">
        {/* THE DURABLE LAUNCH POSTURE — 2026-08-20, AND IT REPLACED THE ARM ON
            THIS TAB. Absent entirely in a plain browser — no bridge, no dead rows.

            ⚠ WHAT CHANGED AND WHY. These two selects used to write the SINGLE-USE
            ARM, under the launch panel's own heading, on the reasoning that one
            sentence must not drift into two. The heading was carrying the entire
            distinction — and it could not. The rows sat among the durable group
            below (tool profile, folder, auto-send), so the operator read them as
            settings, picked Bypass, and got manual/ask on every session after
            the first: the arm was spent by the launch that consumed it and
            expired 30 minutes later, while this control went on displaying the
            value they chose. A fuse drawn as a switch is worse than either one.

            ⚠ AND THEN THE ARM WAS DELETED OUTRIGHT (2026-08-20, Samuel's ruling).
            When it left this tab it was said to have "gone back to the request
            card" — and that card's inbound branch had already stopped rendering
            at the 2026-08-18 consent rewrite, so it went nowhere and nothing
            could arm it (F-233). THIS PAIR IS NOW THE ONLY PERMISSION POSTURE IN
            THE PRODUCT, it is durable, and it is read at exactly ONE call site:
            `session-ipc-ops.js › sessions:launch`, the Launch button the
            operator is pressing on their own thread. H2 still holds and still
            holds BY CONSUMER COUNT — an inbound request a peer triggered carries
            no tool posture at all and starts at manual/ask.
            `main/channel-prefs.js` is the statement of record. */}
        {posture && (
          <>
            <GroupLabel>{LAUNCH_POSTURE_HEADING}</GroupLabel>
            <SettingRow name="Permissions">
              <SelectMenu<ToolMode>
                value={posture.tools}
                options={TOOL_OPTIONS}
                onChange={(tools) => onChangePosture({ tools })}
                ariaLabel="Permissions for agents you launch"
                disabled={postureBusy}
              />
            </SettingRow>
            <SettingRow name="Sends">
              <SelectMenu<MessageMode>
                value={posture.messages}
                options={MESSAGE_OPTIONS}
                onChange={(messages) => onChangePosture({ messages })}
                ariaLabel="Sends for agents you launch"
                disabled={postureBusy}
              />
            </SettingRow>
            {/* THE MODEL (Samuel, 2026-08-22) — durable, per channel, and read
                at the same one call site the two axes are.

                ⚠ IT SITS IN THIS GROUP AND NOT THE ONE BELOW, and the heading is
                why: "When you launch an agent" governs the launches the OPERATOR
                starts, which is exactly the scope of this pick. The group below
                is "for every session on this channel" — an inbound-triggered
                session carries no launch posture at all, and putting the model
                there would promise it applies to runs it cannot reach.

                ⚠ ABSENT ON A MAIN THAT HAS NO MODEL FIELD, never disabled. Such
                a build DROPS the value on write, so a greyed row would be the
                mild version of the failure and a live one would be the loud
                version: a control that says Opus over agents that all launch on
                the default. `modelSupported` is a probe over the get reply — the
                bridge grew a FIELD here, not an op, so there is no member to
                detect (`permission-modes.ts › hasModelKey`).

                ⚠ "Default" IS A REAL PICK and writes NO id — the SDK's own
                default applies. `lib/agent-models.ts` owns the roster and is the
                ONE place an id becomes a label. */}
            {modelSupported && (
              <SettingRow name="Model">
                <SelectMenu<string>
                  value={posture.model ?? AGENT_MODEL_DEFAULT}
                  options={AGENT_MODEL_OPTIONS}
                  onChange={(model) =>
                    onChangePosture({ model: model || null })
                  }
                  ariaLabel="Model for agents you launch"
                  disabled={postureBusy}
                />
              </SettingRow>
            )}
          </>
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
                  if (!selected) onSetToolProfile(option.value);
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
      </div>
    </>
  );
}

/**
 * The heading over the launch posture. ⚠ IT NAMES THE ACT, NOT A TIME WINDOW.
 * The deleted arm's heading ("For the next request you allow") was doing the whole
 * job of saying "this is single-use" and could not carry it; this pair really is
 * durable, so the honest sentence is the one that says WHICH launches it governs
 * — the ones the operator starts. It must never read "for every session": an
 * inbound request a peer triggered carries no tool posture and starts at manual/ask.
 */
const LAUNCH_POSTURE_HEADING = "When you launch an agent";

/** The sub-heading that separates each group. ⚠ Every group on this tab is
 *  DURABLE — nothing single-use is left anywhere in the product — so the headings
 *  say what each one GOVERNS rather than how long it lasts. A heading naming a
 *  time window is the regression (`use-channel-launch-posture.ts`). */
function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="pt-1.5 text-label font-semibold uppercase tracking-wide text-text-secondary">
      {children}
    </p>
  );
}

/** A setting's NAME — primary ink, because it is the thing being set. */
function SettingName({ children }: { children: ReactNode }) {
  return (
    <p className="pt-1.5 text-body font-medium text-text-primary">{children}</p>
  );
}

// ⚠ `Note` STOOD HERE AND IS DELETED (2026-08-22). It was the tab's one
// secondary-line recipe and its only two callers were trust's SCOPE hint and the
// empty-roster line, both of which went with the "Always allow" section. The
// minimal-copy ruling (INVARIANTS §5) stands: a row on this tab is a NAME + a
// CONTROL, and there is now no recipe here to hang a third sentence off.

/**
 * A named setting with its control on the right. The 340px panel is why the
 * control sits beside the name rather than under it: a `SelectMenu` pill is
 * ~120px and the name ~80px, so one line holds both and the column stays
 * scannable.
 */
function SettingRow({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[32px] items-center gap-2">
      <span className="shrink-0 text-body font-medium text-text-primary">
        {name}
      </span>
      <span className="flex min-w-0 flex-1 justify-end">{children}</span>
    </div>
  );
}
