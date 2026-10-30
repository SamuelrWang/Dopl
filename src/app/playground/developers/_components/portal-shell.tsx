"use client";

/**
 * The portal's frame IS /home's: the account rail, then one panel holding the sidebar and the record
 * pane (`HomeFrame`). The sidebar follows `app-sidebar-core.tsx`'s order, on the `_design` recipes.
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
  Palette,
  Users,
  UsersRound,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { HomeFrame } from "@/features/home/components/shell/home-frame";
import { AccountRailCore } from "@/shared/layout/app-shell/account-rail-core";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import b from "../_design/base.module.css";
import { Initials, ICON_100, cx, initialsOf } from "../_design/components";
import { Segmented } from "../_design/interactive";
import side from "../_design/sidebar.module.css";
import o from "../_design/surfaces.module.css";
import tokens from "../_design/tokens.module.css";
import { COMPANY, MEMBERS, PROJECTS, type Env } from "../_data/company";
import { issuesFor } from "../_data/issues";
import { hasIssues } from "../_data/users";
import { FindAnything } from "./find-anything";
import { usePortal, useUsers } from "./portal-store";
import { BASE } from "./ui";

const MARK = "/favicons/android-chrome-512x512.png";

const WORKSPACE = { id: "ws_larkfield", name: COMPANY.name, slug: "larkfield", publicId: "lrkfld", iconUrl: null, role: "owner" as const };

const ENVS: { value: Env; label: string }[] = [
  { value: "live", label: "Live" },
  { value: "test", label: "Test" },
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
      { href: "/design-playground", label: "Design Playground", icon: Palette },
    ],
  },
];

function NavRow({ item, active, alert, alertLabel }: { item: NavItem; active: boolean; alert?: number; alertLabel?: string }) {
  const Icon = item.icon;
  return (
    <Link href={BASE + item.href} aria-current={active ? "page" : undefined} className={cx(o.navItem, side.navRow, active && o.navOn)}>
      <Icon {...ICON_100} aria-hidden="true" className={side.navIcon} />
      <span className={side.navLabel}>{item.label}</span>
      {alert ? (
        <span className={cx(o.navCount, side.alert)} title={alertLabel}>
          <span className={b.dot} />
          {alert}
        </span>
      ) : null}
    </Link>
  );
}

function Sidebar({ fontClass }: { fontClass?: string }) {
  const pathname = usePathname();
  const { state, update } = usePortal();
  const users = useUsers();
  const openIssues = issuesFor(state.env, state.revoked, Object.keys(state.deviceStates)).filter((i) => !state.mutedIssues.includes(i.id)).length;
  const attention = users.filter(hasIssues).length;
  const me = MEMBERS[2];
  return (
    <aside className={cx(side.sidebar, tokens.scope, tokens.u100, fontClass)}>
      <div className={side.identity}>
        <div className={side.projects} role="radiogroup" aria-label="Project">
          {PROJECTS.map((project) => {
            const on = state.project === project.value;
            return (
              <button key={project.value} type="button" role="radio" aria-checked={on} className={cx(side.project, on && side.projectOn)} onClick={() => update((s) => ({ ...s, project: project.value }))}>
                <span className={side.mark}>{project.label.split(" ").at(-1)?.[0]}</span>
                <span className={side.navLabel}>{project.label}</span>
              </button>
            );
          })}
        </div>
        <Segmented label="Environment" options={ENVS.map((e) => e.label)} value={ENVS.findIndex((e) => e.value === state.env)} onChange={(i) => update((s) => ({ ...s, env: ENVS[i].value }))} />
        <FindAnything />
      </div>
      <nav aria-label="Developer portal" className={side.nav}>
        {GROUPS.map((group) => (
          <div key={group.label ?? "top"} className={side.group}>
            {group.label && <span className={side.groupLabel}>{group.label}</span>}
            {group.items.map((item) => {
              const href = BASE + item.href;
              const active = item.href === "" ? pathname === BASE : pathname.startsWith(href);
              const alert = item.href === "/issues" ? openIssues : item.href === "/users" ? attention : undefined;
              const alertLabel = item.href === "/issues" ? "Open issues" : "Users needing attention";
              return <NavRow key={item.href} item={item} active={active} alert={alert} alertLabel={alertLabel} />;
            })}
          </div>
        ))}
      </nav>
      <div className={side.foot}>
        <Initials text={initialsOf(me.name)} small />
        <span className={b.tight}>
          <span className={cx(b.strong, side.ellipsis)}>{me.name}</span>
          <span className={cx(b.smallMuted, side.ellipsis)}>{COMPANY.name}</span>
        </span>
      </div>
    </aside>
  );
}

export function PortalShell({ fontClass, children }: { fontClass?: string; children: ReactNode }) {
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
        list={<Sidebar fontClass={fontClass} />}
      >
        {children}
      </HomeFrame>
    </div>
  );
}
