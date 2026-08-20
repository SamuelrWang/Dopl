"use client";

/**
 * Channels v2 — the SETTINGS tab's AGENT half: the permission arm, the durable
 * per-channel tool profile, the desktop-only working folder, and the standing
 * per-teammate trust roster. All of it INLINE.
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
 * ⚠ NO NEW WRITES, NO NEW PATHS. The arm is still
 * {@link useChannelPermissionPreset} over the desktop bridge, the folder is
 * still {@link useChannelFolder}, and the tool profile and trust rows still call
 * back into `channel-manage.tsx`'s mutations on the page's ONE `gate`. What
 * changed is the chrome.
 *
 * ⚠ NO DEAD ROWS (INVARIANTS §5). Both desktop-only groups are gated on their
 * own bridge, so a plain browser renders neither the controls NOR a heading over
 * nothing.
 *
 * ⚠ NO `role="menu"` IDIOMS. The old panel used checked menu items for
 * everything because a menu may only own menu items; inline, the arm is two
 * `SelectMenu`s, Tools is a real radiogroup and trust is a real `Switch` per
 * row.
 *
 * ⚠ MINIMAL COPY — SAMUEL, 2026-08-19 (third ruling of the day, and it
 * SUPERSEDES the explain-it-in-the-UI half of the two above). The first inline
 * pass carried an explainer paragraph under almost every control — the arm's
 * lifetime, the durable note, the folder note, two sentences of trust scope, and
 * a full sentence per tool profile. **"We should not be explaining everything to
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
import { Avatar } from "@/shared/ui/avatar";
import { SelectMenu } from "@/shared/ui/select-menu";
import { Switch } from "@/shared/ui/switch";
import { useChannelAutoSend } from "../../hooks/use-channel-auto-send";
import { AgentFolderRows, AutoSendRows } from "./settings-desktop-rows";
import { cn } from "@/shared/lib/utils";
import { AGENT_TOOL_PROFILE_LABELS } from "../../constants";
import {
  useChannelPermissionPreset,
  type MessageMode,
  type PermissionPreset,
  type ToolMode,
} from "../../hooks/use-channel-permission-preset";
import { useChannelFolder } from "../../hooks/use-channel-folder";
import { LAUNCH_SETTINGS_HEADING } from "../launch-panel";
import { MESSAGE_OPTIONS, TOOL_OPTIONS } from "../permission-preset-row";
import { PanelHeading } from "./bits";
import { memberPerson } from "./view-model";
import { memberLabel } from "../../lib/channel-display";
import type { AgentToolProfile, ChannelMember } from "../../types";

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

/**
 * ⚠ TRUST IS WORKSPACE-WIDE. The row is
 * `UNIQUE (operator_user_id, trusted_user_id, workspace_id)` — no channel column,
 * ever — while the toggle lives in a per-CHANNEL tab, so a label is the only
 * thing that can carry the scope: every channel and DM in the workspace,
 * including ones that do not exist yet. **That is what this line is for, and it
 * is why the section kept a hint at all when the ruling below cut every other
 * one.**
 *
 * ⚠ WHAT IT NO LONGER SAYS, and where that went (Samuel, 2026-08-19 — minimal
 * copy): the second sentence spelled out the EFFECT — an auto-allowed request
 * raises no card anywhere and the session it starts gets whatever this channel's
 * Tools setting allows, which is the one place the two settings meet. Still
 * true, still the reason the two controls sit on one tab; it is not printed.
 */
const TRUST_SCOPE_HINT = "Applies across the whole workspace";

/**
 * Shown instead of the roster when nobody else is a member yet. ⚠ Rendering
 * NOTHING here hides that standing trust exists from a single-member workspace.
 */
const TRUST_EMPTY_COPY = "Nobody else in this channel yet";

export interface ChannelAgentSettingsProps {
  /** The channel's DB UUID — handed to both desktop bridges as-is. */
  channelId: string;
  /** The caller's own tool profile for THIS channel (never a teammate's). */
  profile: AgentToolProfile;
  /** Other channel members (trust targets); the caller is excluded upstream. */
  otherMembers: ChannelMember[];
  trustedIds: ReadonlySet<string>;
  /** Trust rows with a write in flight; clicks are ignored until it settles. */
  trustBusyIds: ReadonlySet<string>;
  onSetToolProfile: (profile: AgentToolProfile) => void;
  /** True while the tool-profile write is in flight. */
  toolProfileBusy: boolean;
  onToggleTrust: (userId: string, trusted: boolean) => void;
}

/**
 * The bridge-bound half. Split from the view below on the same rule
 * `permission-preset-row.tsx` and `request-folder-row.tsx` follow: the view
 * renders (and is asserted on) with no window and no bridge, and this wrapper is
 * the only thing that needs one.
 */
export function ChannelAgentSettings(props: ChannelAgentSettingsProps) {
  const arm = useChannelPermissionPreset(props.channelId);
  const folder = useChannelFolder(props.channelId);
  const autoSend = useChannelAutoSend(props.channelId);

  return (
    <ChannelAgentSettingsView
      profile={props.profile}
      onSetToolProfile={props.onSetToolProfile}
      toolProfileBusy={props.toolProfileBusy}
      preset={arm.bridge ? arm.preset : null}
      presetBusy={arm.busy}
      onChangePreset={(patch) => void arm.update(patch)}
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
      otherMembers={props.otherMembers}
      trustedIds={props.trustedIds}
      trustBusyIds={props.trustBusyIds}
      onToggleTrust={props.onToggleTrust}
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
  /** The permission arm, or null outside the desktop shell (subsection absent). */
  preset: PermissionPreset | null;
  /** True while an arm write is in flight — both arm selects go inert. */
  presetBusy: boolean;
  onChangePreset: (patch: Partial<PermissionPreset>) => void;
  /** The working folder, or null outside the desktop shell (row absent). */
  folder: AgentFolderState | null;
  /** Auto-send (2026-08-20), or null outside the desktop shell (row absent). */
  autoSend?: { on: boolean; busy: boolean; onToggle: (on: boolean) => void } | null;
  otherMembers: ChannelMember[];
  trustedIds: ReadonlySet<string>;
  trustBusyIds: ReadonlySet<string>;
  onToggleTrust: (userId: string, trusted: boolean) => void;
}

export function ChannelAgentSettingsView({
  profile,
  onSetToolProfile,
  toolProfileBusy,
  preset,
  presetBusy,
  onChangePreset,
  folder,
  autoSend = null,
  otherMembers,
  trustedIds,
  trustBusyIds,
  onToggleTrust,
}: ChannelAgentSettingsViewProps) {
  return (
    <>
      <PanelHeading title="Agent" />
      <div className="flex flex-col gap-1 px-3.5">
        {/* THE ARM. Absent entirely in a plain browser — no bridge, no dead rows.
            ⚠ Its heading is shared verbatim with the launch panel's disclosure
            (`launch-panel.tsx › LAUNCH_SETTINGS_HEADING`), because the two
            surfaces show the SAME pair and one sentence may not drift into
            two. It is an ARM, never "this channel", never "always".
            ⚠ SINCE 2026-08-19 THE HEADING CARRIES THAT ALONE. The sentence
            under it — "…then expires after 30 minutes. Every other session
            starts at Ask each time." — was cut with every other explainer on
            this tab. The TTL is unchanged (`main/channel-prefs.js ARM_TTL_MS`);
            it is simply not printed here, and the heading is what keeps the
            surface from reading as a stored preference. */}
        {preset && (
          <>
            <GroupLabel>{LAUNCH_SETTINGS_HEADING}</GroupLabel>
            <SettingRow name="Permissions">
              <SelectMenu<ToolMode>
                value={preset.tools}
                options={TOOL_OPTIONS}
                onChange={(tools) => onChangePreset({ tools })}
                ariaLabel="Permissions for the next request you allow"
                disabled={presetBusy}
              />
            </SettingRow>
            <SettingRow name="Sends">
              <SelectMenu<MessageMode>
                value={preset.messages}
                options={MESSAGE_OPTIONS}
                onChange={(messages) => onChangePreset({ messages })}
                ariaLabel="Sends for the next request you allow"
                disabled={presetBusy}
              />
            </SettingRow>
          </>
        )}

        {/* THE DURABLE GROUP. Tools is the containment control, so its options
            keep a few-word line where the arm's rows carry none — no hover, no
            drill-in, and no paragraph either (Samuel, 2026-08-19). */}
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

      {/* ⚠ ONE hint line, and it is the SCOPE — see {@link TRUST_SCOPE_HINT} for
          why that is the one claim a per-channel tab cannot leave implicit. */}
      <PanelHeading title="Always allow" />
      <div className="px-3.5">
        <Note>{TRUST_SCOPE_HINT}</Note>
      </div>
      {otherMembers.length === 0 ? (
        <div className="px-3.5 pt-1">
          <Note>{TRUST_EMPTY_COPY}</Note>
        </div>
      ) : (
        <div className="flex flex-col gap-px px-2 pt-1">
          {otherMembers.map((member) => (
            <TrustRow
              key={member.userId}
              member={member}
              trusted={trustedIds.has(member.userId)}
              busy={trustBusyIds.has(member.userId)}
              onToggle={onToggleTrust}
            />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * One teammate's standing trust. Same row anatomy as the Info tab's roster
 * (`info-tab.tsx › MemberRow`) so the two panels sit at one height, with the
 * kit `Switch` where that one carries a `RolePill`.
 *
 * ⚠ Busy DISABLES rather than hiding the control: a double click during the
 * write is the case `channel-manage.tsx › handleToggleTrust` guards, and the row
 * must keep saying which way it is going while it settles.
 */
function TrustRow({
  member,
  trusted,
  busy,
  onToggle,
}: {
  member: ChannelMember;
  trusted: boolean;
  busy: boolean;
  onToggle: (userId: string, trusted: boolean) => void;
}) {
  const name = memberLabel(member);
  return (
    <div className="flex h-[46px] items-center gap-2.5 rounded-[8px] px-2">
      <Avatar person={memberPerson(member)} size="sm" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-medium text-text-primary">
          {name}
        </span>
        {busy && <span className="text-caption text-text-muted">Saving…</span>}
      </span>
      <Switch
        checked={trusted}
        disabled={busy}
        onChange={(next) => onToggle(member.userId, next)}
        aria-label={`Always allow ${name}`}
      />
    </div>
  );
}

/** The sub-heading that separates the ARM from the DURABLE group. ⚠ The split is
 *  by BACKING STORE AND LIFETIME, and it is stated by heading rather than by
 *  ordering — presenting the arm as a stored preference is the H2 defect's own
 *  mental model (`use-channel-permission-preset.ts`). */
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

/**
 * A short secondary line. ⚠ A FEW WORDS, NEVER A PARAGRAPH (Samuel, 2026-08-19).
 * It survived the copy cut for the two places a row genuinely cannot stand
 * alone — trust's SCOPE and the empty roster — and adding a third sentence to
 * this tab through it is the regression the ruling forbids.
 */
function Note({ children }: { children: ReactNode }) {
  return (
    <p className="text-caption leading-snug text-text-secondary">{children}</p>
  );
}

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
