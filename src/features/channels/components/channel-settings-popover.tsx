"use client";

import { useState, type ReactNode } from "react";
import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  SlidersHorizontal,
  Wrench,
} from "lucide-react";
import { Avatar } from "@/shared/ui/avatar";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import { AGENT_TOOL_PROFILE_LABELS, UNRESOLVED_TOOL_PROFILE } from "../constants";
import {
  useChannelPermissionPreset,
  type MessageMode,
  type PermissionPreset,
  type ToolMode,
} from "../hooks/use-channel-permission-preset";
import { MESSAGE_OPTIONS, TOOL_OPTIONS } from "./permission-preset-row";
import type { AgentToolProfile, Channel, ChannelMember } from "../types";

/**
 * WHAT EACH TOOL PROFILE MEANS, in the operator's words. ⚠ Source of truth is
 * `dopl-desktop-app/main/tool-profiles.js` — read its header before touching a
 * line here. These three sentences are the ONLY place a person is told what they
 * are choosing between, and each is a claim about CONTAINMENT.
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
 * profile GRANTS and promise nothing about what is withheld.
 */
const TOOL_PROFILE_OPTIONS: ReadonlyArray<{
  value: AgentToolProfile;
  description: string;
}> = [
  {
    value: "full",
    description:
      "Everything your agent can normally do, including the apps and MCP servers you've connected.",
  },
  {
    value: "dopl_only",
    description:
      "Your files, the web, and your Dopl workspace. No shell, no file writes, no other connectors.",
  },
  {
    value: "read_only",
    description:
      "Your local files, and nothing else. No web, no Dopl, no writes, no way to send anything out.",
  },
];

/**
 * ⚠ TRUST IS WORKSPACE-WIDE. The row is
 * `UNIQUE (operator_user_id, trusted_user_id, workspace_id)` — no channel column,
 * ever — while the toggle lives in a per-CHANNEL popover, so the LABEL is the only
 * thing that can carry the scope: every channel and DM in the workspace,
 * including ones that do not exist yet.
 *
 * ⚠ The second sentence matters as much as the first: an auto-allowed request
 * raises NO card anywhere, so this is the only moment the blast radius can be
 * shown, and the only place the two settings meet — trust decides whether a
 * session spawns unprompted, Tools decides what it can reach.
 */
const TRUST_SCOPE_COPY =
  "Trust covers the whole workspace — every channel and DM you share with someone, including ones created later.";
const TRUST_EFFECT_COPY =
  "Their requests skip the approval card and start a session straight away, with whatever this channel's Tools setting allows.";

/**
 * Shown instead of the roster when nobody else is a member yet. ⚠ Rendering
 * NOTHING here hides that standing trust exists from a single-member workspace.
 */
const TRUST_EMPTY_COPY =
  "Nobody else is in this channel yet. Anyone you add shows up here.";

/** The arm's real lifetime, in the operator's words. See `main/channel-prefs.js`. */
const ARM_NOTE =
  "Applies to the next request you allow here, then expires after 30 minutes. Every other session starts at Ask each time.";

/** The three controls, and the one line each needs at the root of the menu. */
type SettingSection = "permissions" | "sends" | "tools";

interface Props {
  channel: Channel;
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
 * Channel settings popover — THREE named controls plus per-teammate standing
 * trust. The three are deliberately separate because they are three different
 * questions with three different lifetimes, and the previous single "Agent tools &
 * trust" heading let two of them hide behind the third:
 *
 *   PERMISSIONS — whether your agent asks you before each command it runs.
 *   SENDS       — whether messages cross between the two machines without asking.
 *   TOOLS       — which tools the spawned session HAS AT ALL.
 *
 * Tools is the containment control and the reason this popover was reworked: it is
 * what decides whether a teammate's request can reach the connectors on this
 * machine, and it used to be one unexplained menu of three enum names.
 *
 * WHY PERMISSIONS AND SENDS ARE HERE, AND WHAT THEY ARE NOT. They are the two axes
 * of the desktop's permission ARM (`use-channel-permission-preset`), the same pair
 * the inbound request card writes — so this popover shows them when no request is
 * pending, which is the only window in which they were previously invisible. They
 * are NOT stored preferences: single use, 30-minute TTL, consumed by the next
 * launch a human allows. That is exactly what {@link ARM_NOTE} says and why the
 * section is headed "for the next request you allow" rather than "this channel".
 * Presenting them as durable settings is the H2 defect's own mental model and must
 * not come back. Desktop-only, like the folder pill: no bridge, no section.
 *
 * The panel drills rather than stacking every option: eleven option rows with
 * their explanations do not belong in a header dropdown, and the root showing each
 * control's CURRENT value is the thing that makes containment visible at a glance.
 *
 * Every row is a `MenuItem`: a `role="menu"` panel may only own menu items, so
 * both the option lists and the trust toggles use the checked-menuitem idiom
 * rather than a nested Switch or a nested select.
 */
export function ChannelSettingsPopover(props: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Channel settings"
        title="Permissions, sends & tools"
        className="flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
      >
        <SlidersHorizontal size={16} />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        align="right"
        className="min-w-[300px] max-w-[340px]"
      >
        {/* Mounted only while open, so the arm is read when the operator looks at
            it rather than held by an always-mounted header control. */}
        <ChannelSettingsMenu {...props} />
      </Popover>
    </div>
  );
}

/**
 * The bridge-gated, stateful half: the permission arm and the drill-down position.
 * Split from the view below so the view renders (and is asserted on) with no
 * window, no bridge and no DOM — `Popover` returns null while closed and this
 * repo's component tests are static renders.
 */
export function ChannelSettingsMenu({
  channel,
  otherMembers,
  trustedIds,
  trustBusyIds,
  onSetToolProfile,
  toolProfileBusy,
  onToggleTrust,
}: Props) {
  const [section, setSection] = useState<SettingSection | null>(null);
  const { bridge, preset, busy, update } = useChannelPermissionPreset(channel.id);

  return (
    <ChannelSettingsMenuView
      profile={channel.myAgentToolProfile ?? UNRESOLVED_TOOL_PROFILE}
      preset={bridge ? preset : null}
      presetBusy={busy}
      onChangePreset={(patch) => void update(patch)}
      section={section}
      onSection={setSection}
      otherMembers={otherMembers}
      trustedIds={trustedIds}
      trustBusyIds={trustBusyIds}
      onSetToolProfile={onSetToolProfile}
      toolProfileBusy={toolProfileBusy}
      onToggleTrust={onToggleTrust}
    />
  );
}

export interface ChannelSettingsMenuViewProps {
  /** The caller's own tool profile for THIS channel (never a teammate's). */
  profile: AgentToolProfile;
  /** The permission arm, or null outside the desktop shell (section hidden). */
  preset: PermissionPreset | null;
  /** True while an arm write is in flight — both arm rows go inert. */
  presetBusy: boolean;
  onChangePreset: (patch: Partial<PermissionPreset>) => void;
  /** Which control is drilled into; null is the root list. */
  section: SettingSection | null;
  onSection: (next: SettingSection | null) => void;
  otherMembers: ChannelMember[];
  trustedIds: ReadonlySet<string>;
  trustBusyIds: ReadonlySet<string>;
  onSetToolProfile: (profile: AgentToolProfile) => void;
  /** True while the tool-profile write is in flight — the Tools panel goes
   *  inert, the same way `presetBusy` freezes the two arm panels. It is the
   *  DURABLE containment control, so a second pick landing on top of an
   *  unsettled one is the case worth refusing. */
  toolProfileBusy: boolean;
  onToggleTrust: (userId: string, trusted: boolean) => void;
}

export function ChannelSettingsMenuView({
  profile,
  preset,
  presetBusy,
  onChangePreset,
  section,
  onSection,
  otherMembers,
  trustedIds,
  trustBusyIds,
  onSetToolProfile,
  toolProfileBusy,
  onToggleTrust,
}: ChannelSettingsMenuViewProps) {
  if (section === "permissions" && preset) {
    return (
      <OptionPanel
        title="Permissions"
        note={ARM_NOTE}
        options={TOOL_OPTIONS}
        current={preset.tools}
        busy={presetBusy}
        onBack={() => onSection(null)}
        onPick={(tools: ToolMode) => onChangePreset({ tools })}
      />
    );
  }
  if (section === "sends" && preset) {
    return (
      <OptionPanel
        title="Sends"
        note={ARM_NOTE}
        options={MESSAGE_OPTIONS}
        current={preset.messages}
        busy={presetBusy}
        onBack={() => onSection(null)}
        onPick={(messages: MessageMode) => onChangePreset({ messages })}
      />
    );
  }
  if (section === "tools") {
    return (
      <OptionPanel
        title="Tools"
        note="Which tools the session has at all. Saved for this channel, and it applies to every session here until you change it."
        options={TOOL_PROFILE_OPTIONS.map((o) => ({
          value: o.value,
          label: AGENT_TOOL_PROFILE_LABELS[o.value],
          description: o.description,
        }))}
        current={profile}
        busy={toolProfileBusy}
        onBack={() => onSection(null)}
        onPick={(next: AgentToolProfile) => onSetToolProfile(next)}
      />
    );
  }

  const toolMode = TOOL_OPTIONS.find((o) => o.value === preset?.tools);
  const messageMode = MESSAGE_OPTIONS.find((o) => o.value === preset?.messages);
  const toolProfile = TOOL_PROFILE_OPTIONS.find((o) => o.value === profile);

  return (
    <>
      {/* The ARM. Absent entirely in a plain browser — no bridge, no dead rows. */}
      {preset && (
        <>
          <SectionLabel>For the next request you allow</SectionLabel>
          <ControlRow
            icon={<Wrench size={13} />}
            name="Permissions"
            value={toolMode?.label ?? preset.tools}
            description={toolMode?.description}
            onSelect={() => onSection("permissions")}
          />
          <ControlRow
            icon={<MessageSquare size={13} />}
            name="Sends"
            value={messageMode?.label ?? preset.messages}
            description={messageMode?.description}
            onSelect={() => onSection("sends")}
          />
          <Note>{ARM_NOTE}</Note>
          <Divider />
        </>
      )}

      {/* The DURABLE one. This is the containment control. */}
      <SectionLabel>For every session on this channel</SectionLabel>
      <ControlRow
        icon={<Boxes size={13} />}
        name="Tools"
        value={AGENT_TOOL_PROFILE_LABELS[profile]}
        description={toolProfile?.description}
        onSelect={() => onSection("tools")}
      />

      <Divider />
      <SectionLabel>Always allow</SectionLabel>
      <Note>{TRUST_SCOPE_COPY}</Note>
      <Note>{TRUST_EFFECT_COPY}</Note>
      {otherMembers.length === 0 ? (
        <Note>{TRUST_EMPTY_COPY}</Note>
      ) : (
        <div className="max-h-[200px] overflow-y-auto">
          {otherMembers.map((m) => {
            const trusted = trustedIds.has(m.userId);
            const busy = trustBusyIds.has(m.userId);
            return (
              <MenuItem
                key={m.userId}
                showCheck
                active={trusted}
                icon={
                  <Avatar
                    person={{
                      userId: m.userId,
                      email: m.email,
                      displayName: m.displayName,
                      avatarUrl: m.avatarUrl,
                    }}
                    size="xs"
                  />
                }
                description={busy ? "Saving…" : undefined}
                onSelect={() => {
                  if (!busy) onToggleTrust(m.userId, !trusted);
                }}
              >
                {m.displayName || m.email || m.userId}
              </MenuItem>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * One control at the ROOT of the menu: its name, its CURRENT value, and the
 * current value's plain-words line. The value is on the row deliberately — the
 * point of this rework is that a person can see what their agent is scoped to
 * without opening anything, so the root must never render a bare control name.
 */
function ControlRow({
  icon,
  name,
  value,
  description,
  onSelect,
}: {
  icon: ReactNode;
  name: string;
  value: string;
  description?: string;
  onSelect: () => void;
}) {
  return (
    <MenuItem icon={icon} description={description} onSelect={onSelect}>
      <span className="flex items-center gap-1.5">
        <span className="font-medium">{name}</span>
        <span className="min-w-0 truncate text-text-secondary">{value}</span>
        <ChevronRight size={11} className="shrink-0 text-text-muted" />
      </span>
    </MenuItem>
  );
}

/**
 * A drilled control: back row, the control's name, what it governs, then the
 * options with their explanations INLINE — the operator reads what a mode does
 * while choosing it, which is the rule `permission-preset-row` was written to.
 */
function OptionPanel<T extends string>({
  title,
  note,
  options,
  current,
  busy,
  onBack,
  onPick,
}: {
  title: string;
  note: string;
  options: ReadonlyArray<{ value: T; label: string; description?: string }>;
  current: T;
  busy: boolean;
  onBack: () => void;
  onPick: (next: T) => void;
}) {
  return (
    <>
      <MenuItem icon={<ChevronLeft size={13} />} onSelect={onBack}>
        {title}
      </MenuItem>
      <Note>{note}</Note>
      {options.map((option) => (
        <MenuItem
          key={option.value}
          showCheck
          active={option.value === current}
          description={option.description}
          onSelect={() => {
            if (!busy && option.value !== current) onPick(option.value);
          }}
        >
          {option.label}
        </MenuItem>
      ))}
    </>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pb-0.5 pt-1.5 text-micro font-semibold uppercase tracking-wide text-text-muted">
      {children}
    </p>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-0.5 text-caption leading-snug text-text-muted">
      {children}
    </p>
  );
}

function Divider() {
  return <div className="my-1 border-t border-border-subtle" />;
}
