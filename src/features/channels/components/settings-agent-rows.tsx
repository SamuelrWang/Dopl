"use client";

/**
 * Channels — the Settings tab's ROW VOCABULARY (the identity look, DESIGN-LANGUAGE §4): a section
 * is a plain title over ONE white card, and inside it each row carries its own leading hairline.
 * Nothing here reads, writes or decides anything.
 *
 * ⚠ MINIMAL COPY (Samuel, 2026-08-19; INVARIANTS §5): a row is a NAME and a CONTROL, plus at most
 * a few-word caption; there is deliberately no recipe for a third line.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SelectMenu } from "@/shared/ui/select-menu";
import type { SelectMenuOption } from "@/shared/ui/select-menu";
import { AGENT_TOOL_PROFILE_LABELS } from "../constants";
import {
  SHARED_CHANNEL_TOOL_CAPTION,
  profileForChannel,
} from "../lib/tool-profile-resolve";
import { SETTINGS_HELP, SettingHelp } from "./settings-help";
import type { AgentToolProfile, ResolvedAgentToolProfile } from "../types";

/**
 * WHAT EACH TOOL PROFILE MEANS. ⚠ Source of truth is
 * `dopl-desktop-app/main/tool-profiles.js` — read its header before touching a
 * line here. Each rendered line is a claim about CONTAINMENT.
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
 * profile GRANTS and promise nothing about what is withheld; no line ranks a
 * restricted profile as the safe or recommended answer. **≤5 words each, no
 * trailing period.**
 */
const TOOL_PROFILE_OPTIONS: ReadonlyArray<{
  value: AgentToolProfile;
  description: string;
}> = [
  { value: "full", description: "Everything, including connected apps" },
  { value: "dopl_only", description: "Files, web, and Dopl" },
  { value: "read_only", description: "Local files only" },
];

/** A section: a plain title, then its rows in one white card. */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2">
      <h2 className="text-body font-semibold text-text-primary">{title}</h2>
      <div className="white-card flex min-w-0 flex-col px-1 py-0.5">{children}</div>
    </section>
  );
}

/**
 * THE HAIRLINE BETWEEN TWO SETTING ROWS (Samuel, 2026-09-13). Every row carries its own leading
 * line and `first:hidden` keeps it off the top of a card: rows are conditional (bridges, runtimes,
 * gates), so which one is first is a render-time fact no flag could state.
 */
function SettingDivider() {
  return <div aria-hidden data-settings-divider className="border-t border-border-default first:hidden" />;
}

/** A named setting with its control on the right; the eye is looked up by the row's own name. */
export function SettingRow({ name, children }: { name: string; children: ReactNode }) {
  const help = SETTINGS_HELP[name];
  return (
    <>
      <SettingDivider />
      <div data-settings-row className="flex min-h-10 min-w-0 items-center gap-2 px-2">
        <span className="flex shrink-0 items-center gap-1">
          <span className="text-body text-text-primary">{name}</span>
          {help && <SettingHelp name={name} copy={help} />}
        </span>
        <span className="flex min-w-0 flex-1 justify-end">{children}</span>
      </div>
    </>
  );
}

/** A few words under the row above it, inside that row's hairlines. */
export function SettingCaption({
  children,
  tone = "muted",
  role,
}: {
  children: ReactNode;
  tone?: "muted" | "danger" | "warning";
  role?: "alert" | "note";
}) {
  return (
    <p
      role={role}
      className={cn(
        "px-2 pb-2 text-caption",
        tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-text-muted"
      )}
    >
      {children}
    </p>
  );
}

/**
 * One action row (Add members, Delete, Leave): a verb with its glyph, as a button. `destructive`
 * is INK ONLY — every action here opens a confirm dialog, never the write.
 */
export function SettingAction({
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
    <>
      <SettingDivider />
      <button
        type="button"
        data-settings-row
        onClick={onSelect}
        className={cn(
          "flex min-h-10 w-full items-center gap-2 rounded-[8px] px-2 text-left text-body transition-colors",
          "hover:bg-menu-item-hover-bg",
          destructive ? "text-danger" : "text-text-primary"
        )}
      >
        <Icon size={14} aria-hidden className={cn("shrink-0", !destructive && "text-text-muted")} />
        <span className="truncate">{label}</span>
      </button>
    </>
  );
}

/** "Tool access" as `SelectMenu` options at the STORED labels, derived from the table above. */
const TOOL_ACCESS_OPTIONS: ReadonlyArray<SelectMenuOption<AgentToolProfile>> =
  TOOL_PROFILE_OPTIONS.map((option) => ({
    value: option.value,
    label: AGENT_TOOL_PROFILE_LABELS[option.value],
    description: option.description,
  }));

/** The same list with only the SELECTED option wearing the RESOLVED profile's words. */
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

/**
 * "TOOL ACCESS" — the containment pick, labelled with the RESOLVED profile (F-692): a shared
 * channel storing `full` launches at `channel_agent` (ruling B7), and a profile label is a
 * containment claim. The value written is still the stored enum; only the label moves, and the
 * caption appears only when the resolution moved.
 */
export function ToolAccessRow({
  profile,
  shared,
  busy,
  onChange,
}: {
  /** The caller's STORED value for this channel — what the control writes. */
  profile: AgentToolProfile;
  /** `lib/tool-profile-resolve.ts › isSharedChannel`; an unknown count reads as shared. */
  shared: boolean;
  busy: boolean;
  onChange: (next: AgentToolProfile) => void;
}) {
  const resolved = profileForChannel(profile, shared);
  const narrowed = resolved !== profile;
  const options = narrowed ? relabelled(profile, resolved) : TOOL_ACCESS_OPTIONS;
  return (
    <>
      <SettingRow name="Tool access">
        <SelectMenu<AgentToolProfile>
          variant="bare"
          value={profile}
          options={options}
          onChange={(next) => {
            if (next !== profile) onChange(next);
          }}
          ariaLabel="Tool access for agents on this channel"
          disabled={busy}
        />
      </SettingRow>
      {narrowed && <SettingCaption>{SHARED_CHANNEL_TOOL_CAPTION}</SettingCaption>}
    </>
  );
}
