"use client";

/**
 * **THE INFO COLUMN'S SETTINGS TAB, MIRRORED AND RESTYLED** (Samuel, 2026-10-24: *"the settings
 * tab is blank. We need to mirror it in there. Also, have the agent mirror it with the new UI
 * design."*).
 *
 * WHY IT WAS BLANK: `ChannelsInfoPanel` renders its `settings` prop as the tab body and the
 * scene passed none. The product fills it with `settings-slot.tsx › ChannelsSettingsSlot`, which
 * is wired to live mutations, the desktop bridge and the invite roster reads; none of that may
 * fire from staging, so this is a face over local state instead, mounted in the same slot.
 *
 * MIRRORS, ROW FOR ROW (product files untouched):
 *  - channel view = `settings-tab.tsx › ChannelsSettingsTab` with its two slots,
 *    `settings-agent.tsx › ChannelAgentSettingsView` (Runtime, Permissions + Details,
 *    Messaging, Tool access + the shared-channel caption, Use my tools, Working folder +
 *    Use default, Launch agents, Direct agents) and `settings-channel-agents.tsx` (Responder),
 *    then the Channel actions (Add members, Make public/private, Delete, Leave);
 *  - thread view = `thread-settings-tab.tsx` (Mode, Delete thread).
 * The gates are the product's (`canInvite`, `canToggleVisibility`, `canDelete`, `canLeave`,
 * creator-only Mode), so the staged viewer, who owns every staged channel, gets no Leave row,
 * exactly as an owner does in the product. Option lists and labels are the product's own
 * constants, imported, so the two cannot word a value differently. The per-runtime Details
 * readings are the desktop adapters' real tables (`main/runtime/permission-level.js`), copied.
 *
 * DESIGN (docs/DESIGN-LANGUAGE.md + this page's approved rulings): sections sit on the white
 * pane under a plain text title (Samuel, 2026-10-24: the grey chip removed, "Agent Settings"
 * capitalised); each section's rows
 * are one white card (hairline, 12px, the one soft shadow) with a hairline between rows (the
 * product's 2026-09-13 rule); dropdowns are the value plus a chevron, no pill (Identities item
 * 7, `identities-staging/page/select-menu.tsx › bare`); the Details well is the outer-panel grey
 * Samuel picked for the agent view's context well (`--home-card`). Labels + controls only.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, Hash, LogOut, Trash2, UserPlus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PILL_BUTTON } from "@/shared/ui/small-action-button";
import { SelectMenu, type SelectMenuOption } from "@/features/identities-staging/page/select-menu";
import { AGENT_TOOL_PROFILE_LABELS, THREAD_MODE_LABELS } from "@/features/channels/constants";
import {
  LEVEL_OPTIONS,
  MESSAGE_OPTIONS,
} from "@/features/channels/components/permission-preset-row";
import { SETTINGS_HELP, SettingHelp } from "@/features/channels/components/settings-help";
import {
  SHARED_CHANNEL_TOOL_CAPTION,
  isSharedChannel,
  profileForChannel,
} from "@/features/channels/lib/tool-profile-resolve";
import type { MessageMode } from "@/features/channels/lib/permission-modes";
import type { PermissionLevel } from "@/features/channels/lib/launch-selection";
import type {
  AgentToolProfile,
  Channel,
  ChannelMember,
  ChannelThread,
  ThreadMode,
} from "@/features/channels/types";
import { StagingSettingsDialogs, type StagingSettingsDialog } from "./settings-dialogs";

/** The desktop's registered runtimes, in registry order, with each level's own reading. */
const RUNTIMES = [
  { id: "claude", label: "Claude Code", ask: ["Ask each time", "manual"], auto: ["Auto", "auto"], full: ["Bypass", "bypass"] },
  { id: "codex", label: "Codex", ask: ["Ask for approval", "on-request/workspace-write"], auto: ["Approve for me", "on-request/workspace-write/guardian_subagent"], full: ["Full access", "never/danger-full-access"] },
  { id: "cursor", label: "Cursor", ask: ["Allowlist", "allowlist"], auto: ["Auto-review", "auto-review"], full: ["Run Everything", "run-everything"] },
  { id: "muse", label: "Muse", ask: ["Ask me", "promptUnmatched"], auto: ["Ask on request", "onRequest"], full: ["Allow all", "allowAll"] },
  { id: "grok", label: "Grok", ask: ["Ask me", "default"], auto: ["Auto", "autoMode"], full: ["Approve all", "approve-all"] },
] as const;

const RUNTIME_OPTIONS: ReadonlyArray<SelectMenuOption<string>> = [
  { value: "", label: "Default" },
  ...RUNTIMES.map((r) => ({ value: r.id, label: r.label })),
];

/** `settings-agent-rows.tsx › TOOL_PROFILE_OPTIONS`, labelled from the shared map. */
const TOOL_OPTIONS: ReadonlyArray<SelectMenuOption<AgentToolProfile>> = (
  [
    ["full", "Everything, including connected apps"],
    ["dopl_only", "Files, web, and Dopl"],
    ["read_only", "Local files only"],
  ] as const
).map(([value, description]) => ({ value, label: AGENT_TOOL_PROFILE_LABELS[value], description }));

type OnOff = "off" | "on";
const ON_OFF: ReadonlyArray<SelectMenuOption<OnOff>> = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
];
type Launch = "off" | "channel" | "every";
const LAUNCH_OPTIONS: ReadonlyArray<SelectMenuOption<Launch>> = [
  { value: "off", label: "Cannot launch agents" },
  { value: "channel", label: "In this channel" },
  { value: "every", label: "In every channel" },
];
type Direct = "off" | "every";
const DIRECT_OPTIONS: ReadonlyArray<SelectMenuOption<Direct>> = [
  { value: "off", label: "Cannot direct agents" },
  { value: "every", label: "In every channel" },
];
type Responder = "none" | "last_addressed";
const RESPONDER_OPTIONS: ReadonlyArray<SelectMenuOption<Responder>> = [
  { value: "none", label: "No one" },
  { value: "last_addressed", label: "Last addressed" },
];
const MODE_OPTIONS: ReadonlyArray<SelectMenuOption<ThreadMode>> = (
  ["interactive", "autonomous"] as const
).map((value) => ({ value, label: THREAD_MODE_LABELS[value] }));

const DEFAULT_FOLDER = "~/Dopl";

/** A section: a plain text title, then its rows in one white card. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="uis-st-section" aria-label={title}>
      <h2 className="uis-st-title">{title}</h2>
      <div className="white-card uis-st-card">{children}</div>
    </section>
  );
}

/** Name (with the product's help eye, keyed by the product's row name) and its control. */
function Row({
  name,
  helpKey = name,
  children,
}: {
  name: string;
  helpKey?: string;
  children: React.ReactNode;
}) {
  const help = SETTINGS_HELP[helpKey];
  return (
    <div className="uis-st-row" data-settings-row="">
      <span className="uis-st-name">
        {name}
        {help && <SettingHelp name={helpKey} copy={help} />}
      </span>
      <span className="uis-st-control">{children}</span>
    </div>
  );
}

function Action({
  icon: Icon,
  label,
  destructive = false,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  destructive?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-settings-row=""
      className="uis-st-action"
      data-tone={destructive ? "danger" : undefined}
      onClick={onSelect}
    >
      <Icon size={14} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

/** Permissions' Details disclosure: each runtime's own reading of the chosen level. */
function PermissionDetails({ level }: { level: PermissionLevel }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="uis-st-details">
      <button
        type="button"
        aria-expanded={open}
        className="uis-st-details-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Details
      </button>
      {open && (
        <ul className="card-well uis-st-well" aria-label="Permissions by runtime">
          {RUNTIMES.map((r) => (
            <li key={r.id} className="uis-st-well-row">
              <span>
                {r.label} · {r[level][0]}
              </span>
              <span className="uis-st-mono">{r[level][1]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChannelSettings({ channel, members }: { channel: Channel; members: readonly ChannelMember[] }) {
  const [runtime, setRuntime] = useState("");
  const [level, setLevel] = useState<PermissionLevel>("auto");
  const [messages, setMessages] = useState<MessageMode>("auto_inbound");
  const [tools, setTools] = useState<AgentToolProfile>("full");
  const [useMyTools, setUseMyTools] = useState<OnOff>("off");
  const [folder, setFolder] = useState<string | null>(`~/Code/${channel.name}`);
  const [launch, setLaunch] = useState<Launch>("channel");
  const [direct, setDirect] = useState<Direct>("off");
  const [responder, setResponder] = useState<Responder>("last_addressed");
  const [visibility, setVisibility] = useState(channel.visibility);
  const [dialog, setDialog] = useState<StagingSettingsDialog>(null);

  const shared = isSharedChannel(channel.memberCount);
  const resolved = profileForChannel(tools, shared);
  const toolOptions =
    resolved === tools
      ? TOOL_OPTIONS
      : TOOL_OPTIONS.map((o) =>
          o.value === tools ? { ...o, label: AGENT_TOOL_PROFILE_LABELS[resolved] } : o
        );

  // The product's gates (`settings-tab.tsx`), over the staged viewer.
  const canManage = channel.role === "owner" || channel.myWorkspaceRole === "owner";
  const isOwner = channel.role === "owner";
  const canInvite = channel.isMember && !channel.isDirect;
  const canToggleVisibility = canManage && !channel.isDirect;
  const canLeave = channel.isMember && !isOwner && !channel.isDirect;
  const canDelete = canManage || (channel.isMember && channel.isDirect);

  return (
    <div className="uis-st">
      <Section title="Agent Settings">
        <Row name="Runtime">
          <SelectMenu<string> value={runtime} options={RUNTIME_OPTIONS} onChange={setRuntime} ariaLabel="Runtime for agents you launch" />
        </Row>
        <Row name="Permissions">
          <SelectMenu<PermissionLevel> value={level} options={LEVEL_OPTIONS} onChange={setLevel} ariaLabel="Permissions for agents you launch" />
        </Row>
        <PermissionDetails level={level} />
        <Row name="Messaging">
          <SelectMenu<MessageMode> value={messages} options={MESSAGE_OPTIONS} onChange={setMessages} ariaLabel="Messaging for agents you launch" />
        </Row>
        <Row name="Tool access">
          <SelectMenu<AgentToolProfile> value={tools} options={toolOptions} onChange={setTools} ariaLabel="Tool access for agents on this channel" />
        </Row>
        {resolved !== tools && <p className="uis-st-caption">{SHARED_CHANNEL_TOOL_CAPTION}</p>}
        {shared && (
          <Row name="Use my tools">
            <SelectMenu<OnOff> value={useMyTools} options={ON_OFF} onChange={setUseMyTools} ariaLabel="Whether agents here may use your own tools on turns you start" />
          </Row>
        )}
        <Row name="Working folder" helpKey="Working Folder">
          <span className="uis-st-folder">
            <button
              type="button"
              className="uis-st-path"
              aria-label="Change the working folder for this channel's agents"
              onClick={() => setFolder(`~/Code/${channel.name}`)}
            >
              {folder ?? DEFAULT_FOLDER}
            </button>
            {folder && (
              <button type="button" className={PILL_BUTTON} onClick={() => setFolder(null)}>
                Use default
              </button>
            )}
          </span>
        </Row>
        <Row name="Launch agents">
          <SelectMenu<Launch> value={launch} options={LAUNCH_OPTIONS} onChange={setLaunch} ariaLabel="Whether agents may launch further agents, and where" />
        </Row>
        <Row name="Direct agents">
          <SelectMenu<Direct> value={direct} options={DIRECT_OPTIONS} onChange={setDirect} ariaLabel="Whether your other sessions may send private instructions to agents running on this Mac" />
        </Row>
        <Row name="Responder">
          <SelectMenu<Responder> value={responder} options={RESPONDER_OPTIONS} onChange={setResponder} ariaLabel="Who answers my unaddressed messages in this channel" />
        </Row>
      </Section>

      <Section title="Channel">
        {canInvite && <Action icon={UserPlus} label="Add members" onSelect={() => setDialog("invite")} />}
        {canToggleVisibility && (
          <Action
            icon={Hash}
            label={`Make ${visibility === "public" ? "private" : "public"}`}
            onSelect={() =>
              // Private → public confirms (`go-public-dialog.tsx`); public → private does not.
              visibility === "private" ? setDialog("go-public") : setVisibility("private")
            }
          />
        )}
        {canDelete && (
          <Action
            icon={Trash2}
            label={`Delete ${channel.isDirect ? "conversation" : "channel"}`}
            destructive
            onSelect={() => setDialog("delete-channel")}
          />
        )}
        {canLeave && <Action icon={LogOut} label="Leave channel" onSelect={() => setDialog("leave")} />}
      </Section>

      <StagingSettingsDialogs
        open={dialog}
        onClose={() => setDialog(null)}
        channel={{ ...channel, visibility }}
        members={members}
        onGoPublic={() => setVisibility("public")}
      />
    </div>
  );
}

function ThreadSettings({
  channel,
  members,
  thread,
  currentUserId,
}: {
  channel: Channel;
  members: readonly ChannelMember[];
  thread: ChannelThread;
  currentUserId: string;
}) {
  const [mode, setMode] = useState<ThreadMode>(thread.mode);
  const [dialog, setDialog] = useState<StagingSettingsDialog>(null);
  // `thread-manage.tsx`: Mode is creator-only; Delete is creator or channel manager.
  const canSetMode = thread.createdBy === currentUserId;
  const canDelete = canSetMode || channel.role === "owner";
  return (
    <div className="uis-st">
      <Section title="Thread">
        {canSetMode && (
          <Row name="Mode">
            <SelectMenu<ThreadMode> value={mode} options={MODE_OPTIONS} onChange={setMode} ariaLabel="How this thread is worked" />
          </Row>
        )}
        {canDelete && (
          <Action icon={Trash2} label="Delete thread" destructive onSelect={() => setDialog("delete-thread")} />
        )}
      </Section>
      <StagingSettingsDialogs
        open={dialog}
        onClose={() => setDialog(null)}
        channel={channel}
        members={members}
        thread={thread}
      />
    </div>
  );
}

/** The Settings tab body: the thread face while a thread is open, else the channel face. */
export function StagingSettingsTab({
  channel,
  members,
  thread,
  currentUserId,
}: {
  channel: Channel;
  members: readonly ChannelMember[];
  thread: ChannelThread | null;
  currentUserId: string;
}) {
  if (thread) {
    return (
      <ThreadSettings
        key={thread.id}
        channel={channel}
        members={members}
        thread={thread}
        currentUserId={currentUserId}
      />
    );
  }
  return <ChannelSettings key={channel.id} channel={channel} members={members} />;
}
