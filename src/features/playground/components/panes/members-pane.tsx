"use client";

import { useState } from "react";
import {
  BookOpen,
  ChevronRight,
  Search,
  Sparkles,
  UserPlus,
  Users,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { AvatarWithPresence } from "@/shared/ui/avatar-with-presence";
import { EmptyState } from "@/shared/ui/empty-state";
import { SectionBox } from "@/shared/ui/section-box";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { useLiveMembers, type PaneAccessRow, type PaneMember, type PaneRole } from "./members-pane-live";

/**
 * Playground clone of the members console (two-pane master-detail of
 * `features/members/components/members-v2/`). Renders the fixed demo
 * roster until `useLiveMembers` (sibling `members-pane-live.ts`) has real
 * rows from the guest workspace, then shows those. Read-only GET polling, no
 * writes; Teams/Access tabs stay static (live twins need more endpoints).
 */

interface DemoResource {
  id: string;
  name: string;
  typeLabel: string;
  icon: LucideIcon;
}

const DEMO_MEMBERS: PaneMember[] = [
  {
    person: { userId: "guest", email: null, displayName: "Guest", avatarUrl: null },
    role: "owner",
    roleLabel: "owner",
    isSelf: true,
    online: true,
    activityLabel: "Active now",
    joinedLabel: "joined 2026-08-16",
    teams: [],
    access: [], // owners short-circuit to the full-access copy
  },
  {
    person: { userId: "guest-agent", email: null, displayName: "Guest's Agent", avatarUrl: null },
    role: "member",
    roleLabel: "member",
    isSelf: false,
    online: true,
    activityLabel: "Active now",
    joinedLabel: "joined 2026-08-16",
    teams: [],
    access: [
      { name: "Getting started", typeLabel: "Knowledge base", level: "edit" },
      { name: "Daily digest", typeLabel: "Skill", level: "read" },
    ],
  },
];

const DEMO_RESOURCES: DemoResource[] = [
  { id: "kb-getting-started", name: "Getting started", typeLabel: "Knowledge base", icon: BookOpen },
  { id: "skill-daily-digest", name: "Daily digest", typeLabel: "Skill", icon: Sparkles },
];

type TabKey = "members" | "teams" | "access";

/** Same weight-not-hue role recipe as `member-bits.tsx › RolePill`. */
const ROLE_STYLE: Record<PaneRole, string> = {
  owner: "bg-surface-invert border-surface-invert text-text-on-invert",
  member: "bg-surface-raised-2 border-border-default text-text-secondary",
};

/** Same recipe as `team-bits.tsx › ScopePill`. */
const SCOPE: Record<PaneAccessRow["level"], { label: string; className: string }> = {
  edit: { label: "Can edit", className: "bg-bg-inset border-border-strong text-text-primary" },
  read: { label: "Read only", className: "bg-surface-raised-2 border-border-default text-text-secondary" },
};

const ICON_BTN =
  "flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary";

const SEARCH_PLACEHOLDER: Record<TabKey, string> = {
  members: "Search members",
  teams: "Search teams",
  access: "Search resources",
};

export function MembersPane() {
  const [tab, setTab] = useState<TabKey>("members");
  const [query, setQuery] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState(
    DEMO_MEMBERS[0].person.userId
  );
  const [selectedResourceId, setSelectedResourceId] = useState(
    DEMO_RESOURCES[0].id
  );

  // Real roster once the session's polls answer; demo until then. A stale
  // selected id (demo → live swap) falls back to the first row below.
  const members = useLiveMembers() ?? DEMO_MEMBERS;

  const q = query.trim().toLowerCase();
  const visibleMembers = members.filter(
    (m) => q === "" || (m.person.displayName ?? "").toLowerCase().includes(q)
  );
  const visibleResources = DEMO_RESOURCES.filter(
    (r) => q === "" || r.name.toLowerCase().includes(q)
  );

  const selectedMember =
    members.find((m) => m.person.userId === selectedMemberId) ?? members[0];
  const selectedResource =
    DEMO_RESOURCES.find((r) => r.id === selectedResourceId) ?? DEMO_RESOURCES[0];

  const handleTabChange = (next: TabKey) => {
    setTab(next);
    setQuery("");
  };

  return (
    <div className="page-float flex antialiased">
      {/* ── Left list pane ─────────────────────────────────────────── */}
      <div className="flex w-[372px] shrink-0 flex-col border-r border-border-default">
        <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-3.5">
          <h1 className="text-title font-semibold tracking-tight text-text-primary">
            Members
          </h1>
          <span className="text-caption text-text-muted">
            {members.length}
          </span>
          <span className="flex-1" />
          <button type="button" className={ICON_BTN} aria-label="New team" title="New team">
            <Users size={16} />
          </button>
          <button type="button" className={ICON_BTN} aria-label="Add members" title="Add members">
            <UserPlus size={16} />
          </button>
        </div>

        <div className="concave-field relative mx-3.5 mb-3 rounded-[9px]">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={SEARCH_PLACEHOLDER[tab]}
            spellCheck={false}
            className="h-9 w-full bg-transparent pl-[33px] pr-3 text-body text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>

        <SegmentedControl
          options={[
            { key: "members" as const, label: "Members", count: members.length },
            { key: "teams" as const, label: "Teams", count: 0 },
            { key: "access" as const, label: "Access", count: DEMO_RESOURCES.length },
          ]}
          value={tab}
          onChange={handleTabChange}
          className="mx-3.5 mb-3"
        />

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border-default pb-4">
          {tab === "members" &&
            (visibleMembers.length === 0 ? (
              <EmptyCopy text="No members match." />
            ) : (
              visibleMembers.map((m) => (
                <MemberRow
                  key={m.person.userId}
                  member={m}
                  selected={m.person.userId === selectedMemberId}
                  onSelect={() => setSelectedMemberId(m.person.userId)}
                />
              ))
            ))}

          {tab === "teams" && (
            <EmptyCopy text="No teams yet — create one to scope access." />
          )}

          {tab === "access" &&
            (visibleResources.length === 0 ? (
              <EmptyCopy text="No resources match." />
            ) : (
              visibleResources.map((r) => (
                <ResourceRow
                  key={r.id}
                  resource={r}
                  selected={r.id === selectedResourceId}
                  onSelect={() => setSelectedResourceId(r.id)}
                />
              ))
            ))}
        </div>
      </div>

      {/* ── Right detail pane ──────────────────────────────────────── */}
      {tab === "members" ? (
        <MemberDetail member={selectedMember} />
      ) : tab === "access" ? (
        <ResourceDetail resource={selectedResource} />
      ) : (
        <EmptyState icon={UsersRound} title="Nothing to show yet." />
      )}
    </div>
  );
}

// ─── List rows ────────────────────────────────────────────────────────

function RowShell({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors",
        selected ? "bg-surface-raised-3" : "hover:bg-surface-raised-1"
      )}
    >
      {selected && (
        <span className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-r-[3px] bg-text-primary" />
      )}
      {children}
    </button>
  );
}

function MemberRow({
  member: m,
  selected,
  onSelect,
}: {
  member: PaneMember;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <RowShell selected={selected} onSelect={onSelect}>
      <AvatarWithPresence person={m.person} online={m.online} size="xs" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-body font-semibold text-text-primary">
            {m.person.displayName}
          </span>
          {m.isSelf && (
            <span className="shrink-0 text-micro font-semibold uppercase tracking-wide text-text-muted">
              You
            </span>
          )}
          <span className="flex-1" />
          <span className="shrink-0 text-micro font-medium uppercase tracking-wide text-text-secondary">
            {m.roleLabel}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-caption text-text-secondary">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              m.online ? "bg-success" : "bg-surface-raised-4 ring-1 ring-border-default"
            )}
          />
          <span className="min-w-0 truncate">{m.activityLabel}</span>
        </span>
      </span>
    </RowShell>
  );
}

function ResourceRow({
  resource: r,
  selected,
  onSelect,
}: {
  resource: DemoResource;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = r.icon;
  return (
    <RowShell selected={selected} onSelect={onSelect}>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-bg-inset text-text-secondary">
        <Icon size={12} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="min-w-0 flex-1 truncate text-body font-semibold text-text-primary">
            {r.name}
          </span>
          <span className="shrink-0 text-micro font-medium uppercase tracking-wide text-text-secondary">
            Everyone
          </span>
        </span>
        <span className="block truncate text-caption text-text-secondary">
          {r.typeLabel}
        </span>
      </span>
    </RowShell>
  );
}

function EmptyCopy({ text }: { text: string }) {
  return (
    <p className="px-4 py-2.5 text-caption leading-relaxed text-text-muted">{text}</p>
  );
}

// ─── Detail panes ─────────────────────────────────────────────────────

/** Shared face of the static role/scope chips (`RolePill` / `ScopePill`). */
function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-label uppercase tracking-wider",
        className
      )}
    >
      {children}
    </span>
  );
}

function MemberDetail({ member: m }: { member: PaneMember }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-border-default px-3.5">
        <span className="shrink-0 text-small font-medium text-text-secondary">
          Members
        </span>
        <ChevronRight size={13} className="shrink-0 text-text-muted" />
        <span className="min-w-0 truncate text-lead font-semibold text-text-primary">
          {m.person.displayName}
        </span>
        <span className="flex-1" />
        <Pill className={ROLE_STYLE[m.role]}>{m.roleLabel}</Pill>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-14 pb-16 pt-8">
        <div className="mx-auto flex max-w-[760px] flex-col gap-4">
          <section className="flex items-center gap-4 rounded-[14px] border border-border-strong bg-bg-elevated px-5 py-4">
            <AvatarWithPresence person={m.person} online={m.online} size="md" />
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-2 truncate text-display font-semibold tracking-tight text-text-primary">
                {m.person.displayName}
                {m.isSelf && (
                  <span className="text-micro font-semibold uppercase tracking-wide text-text-muted">
                    You
                  </span>
                )}
              </h2>
              <p className="mt-1 truncate text-caption text-text-muted">
                {m.roleLabel} · {m.activityLabel}{m.joinedLabel ? ` · ${m.joinedLabel}` : ""}
              </p>
            </div>
          </section>

          <SectionBox label={`Teams · ${m.teams.length}`}>
            {m.teams.length === 0 ? (
              <p className="px-4 py-3 text-caption text-text-muted">
                Not in any team.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {m.teams.map((name) => (
                  <li key={name} className="truncate px-4 py-2.5 text-body text-text-primary">{name}</li>
                ))}
              </ul>
            )}
          </SectionBox>

          <SectionBox label="Effective access" meta="highest level from any team">
            {m.role === "owner" ? (
              <p className="px-4 py-3 text-caption text-text-muted">
                Owners always have full access to everything.
              </p>
            ) : m.access.length === 0 ? (
              <p className="px-4 py-3 text-caption text-text-muted">
                No team grants yet — access follows the member&apos;s role.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {m.access.map((row) => (
                  <li
                    key={row.name}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-text-primary">
                        {row.name}
                      </span>
                      <span className="block truncate text-micro capitalize text-text-muted">
                        {row.typeLabel}
                      </span>
                    </span>
                    <Pill className={SCOPE[row.level].className}>
                      {SCOPE[row.level].label}
                    </Pill>
                  </li>
                ))}
              </ul>
            )}
          </SectionBox>
        </div>
      </div>
    </div>
  );
}

function ResourceDetail({ resource: r }: { resource: DemoResource }) {
  const Icon = r.icon;
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-border-default px-3.5">
        <span className="shrink-0 text-small font-medium text-text-secondary">
          Access
        </span>
        <ChevronRight size={13} className="shrink-0 text-text-muted" />
        <span className="min-w-0 truncate text-lead font-semibold text-text-primary">
          {r.name}
        </span>
        <span className="flex-1" />
        <SegmentedControl
          options={[
            { key: "workspace" as const, label: "Everyone" },
            { key: "teams" as const, label: "Teams" },
          ]}
          value="workspace"
          onChange={() => {}}
          className="w-[190px]"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-14 pb-16 pt-8">
        <div className="mx-auto flex max-w-[760px] flex-col gap-4">
          <section className="flex items-center gap-4 rounded-[14px] border border-border-strong bg-bg-elevated px-5 py-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-inset text-text-secondary">
              <Icon size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-display font-semibold tracking-tight text-text-primary">
                {r.name}
              </h2>
              <p className="mt-1 text-caption text-text-secondary">
                {r.typeLabel} · workspace-wide — every member has access at
                their role&apos;s default level
              </p>
            </div>
          </section>

          <SectionBox
            label="Team access"
            meta="grants don't apply while workspace-wide"
          >
            <p className="px-4 py-3 text-caption text-text-muted">
              No teams yet — create one from the Teams tab to scope access.
            </p>
          </SectionBox>
        </div>
      </div>
    </div>
  );
}
