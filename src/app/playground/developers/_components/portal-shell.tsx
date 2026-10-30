"use client";

/**
 * The portal's frame IS /home's: the account rail, then one panel holding the sidebar and the record
 * pane (`HomeFrame`). Nav rows take /home's selected face, the ink row.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  Cpu,
  FlaskConical,
  KeyRound,
  LayoutGrid,
  Link2,
  Users,
  UsersRound,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { HomeFrame } from "@/features/home/components/shell/home-frame";
import { AccountRailCore } from "@/shared/layout/app-shell/account-rail-core";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import { cn } from "@/shared/lib/utils";
import { IdentityFace } from "@/shared/ui/identity-face";
import { QUIET_HEADING_TEXT } from "@/shared/ui/section-heading";
import { SelectMenu } from "@/shared/ui/select-menu";
import { COMPANY, MEMBERS, PROJECTS, type Env } from "../_data/company";
import { issuesFor } from "../_data/issues";
import { FindAnything } from "./find-anything";
import { usePortal } from "./portal-store";
import { BASE } from "./ui";

const MARK = "/favicons/android-chrome-512x512.png";

const WORKSPACE = { id: "ws_larkfield", name: COMPANY.name, slug: "larkfield", publicId: "lrkfld", iconUrl: null, role: "owner" as const };

const ENV_OPTIONS: { value: Env; label: string }[] = [
  { value: "test", label: "Test" },
  { value: "live", label: "Live" },
];

type NavItem = { href: string; label: string; icon: LucideIcon };

const GROUPS: { label: string | null; items: NavItem[] }[] = [
  { label: null, items: [{ href: "", label: "Overview", icon: LayoutGrid }] },
  {
    label: "Build",
    items: [
      { href: "/devices", label: "Devices", icon: Cpu },
      { href: "/connect", label: "Connect page", icon: Link2 },
      { href: "/playground", label: "Playground", icon: FlaskConical },
    ],
  },
  {
    label: "Operate",
    items: [
      { href: "/users", label: "Users", icon: Users },
      { href: "/activity", label: "Activity", icon: Activity },
      { href: "/issues", label: "Issues", icon: AlertCircle },
    ],
  },
  {
    label: "Configure",
    items: [
      { href: "/keys", label: "API keys", icon: KeyRound },
      { href: "/webhooks", label: "Webhooks", icon: Webhook },
      { href: "/usage", label: "Usage", icon: BarChart3 },
      { href: "/team", label: "Team", icon: UsersRound },
    ],
  },
];

function NavRow({ item, active, badge }: { item: NavItem; active: boolean; badge?: number }) {
  const Icon = item.icon;
  return (
    <Link
      href={BASE + item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-field px-2.5 text-body transition-colors",
        active ? "bg-surface-cta font-medium text-text-on-cta" : "text-text-secondary hover:bg-menu-item-hover-bg hover:text-text-primary"
      )}
    >
      <Icon size={14} strokeWidth={1.8} aria-hidden="true" className={active ? undefined : "text-text-muted"} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {badge ? (
        <span className={cn("text-micro tabular-nums", active ? "text-text-on-cta" : "text-warning")}>{badge}</span>
      ) : null}
    </Link>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const { state, update } = usePortal();
  const openIssues = issuesFor(state.env, state.revoked, Object.keys(state.deviceStates)).filter((i) => !state.mutedIssues.includes(i.id)).length;
  const me = MEMBERS[2];
  return (
    <div className="flex w-58 shrink-0 flex-col gap-3 px-3 pb-3">
      <div className="flex flex-col gap-2">
        <SelectMenu
          variant="outline"
          ariaLabel="Project"
          value={state.project}
          options={PROJECTS}
          onChange={(project) => update((s) => ({ ...s, project }))}
          className="w-full justify-between"
        />
        <SelectMenu
          variant="outline"
          ariaLabel="Environment"
          value={state.env}
          options={ENV_OPTIONS}
          onChange={(env) => update((s) => ({ ...s, env }))}
          className="w-full justify-between"
        />
        <FindAnything />
      </div>
      <nav aria-label="Developer portal" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {GROUPS.map((group) => (
          <div key={group.label ?? "top"} className="flex flex-col gap-0.5">
            {group.label && <span className={cn(QUIET_HEADING_TEXT, "px-2.5 pb-1 pt-0.5")}>{group.label}</span>}
            {group.items.map((item) => {
              const href = BASE + item.href;
              const active = item.href === "" ? pathname === BASE : pathname.startsWith(href);
              return <NavRow key={item.href} item={item} active={active} badge={item.href === "/issues" ? openIssues : undefined} />;
            })}
          </div>
        ))}
      </nav>
      <div className="flex items-center gap-2 px-1 pt-1">
        <IdentityFace size="s" name={me.name} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-caption font-medium text-text-primary">{me.name}</span>
          <span className="truncate text-micro text-text-muted">{COMPANY.name}</span>
        </span>
      </div>
    </div>
  );
}

export function PortalShell({ children }: { children: ReactNode }) {
  return (
    <div className={shell.root} style={{ "--shell-rail-w": "54px" } as CSSProperties}>
      <HomeFrame
        face="overview"
        rail={
          <AccountRailCore
            workspaces={[WORKSPACE]}
            activeWorkspacePublicId={WORKSPACE.publicId}
            markSrc={MARK}
            onNavigate={(path) => {
              if (path === "/home") window.location.assign("/playground/overview");
            }}
          />
        }
        header={<div className="h-3 shrink-0" />}
        list={<Sidebar />}
      >
        {children}
      </HomeFrame>
    </div>
  );
}
