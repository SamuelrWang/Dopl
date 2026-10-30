"use client";

/** The portal: the sidebar and the page's content, on one surface. No rail, no panel around either. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
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
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import { NavRow, Segmented } from "../_design/ui";
import { AccountRow, NavGroup, PortalFrame, ProjectPicker, Sidebar } from "../_design/ui-sidebar";
import { COMPANY, MEMBERS, PROJECTS, type Env } from "../_data/company";
import { issuesFor } from "../_data/issues";
import { hasIssues } from "../_data/users";
import { FindAnything } from "./find-anything";
import { usePortal, useUsers } from "./portal-store";
import { BASE } from "./ui";

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

function PortalSidebar({ fontClass }: { fontClass?: string }) {
  const pathname = usePathname();
  const { state, update } = usePortal();
  const users = useUsers();
  const openIssues = issuesFor(state.env, state.revoked, Object.keys(state.deviceStates)).filter((i) => !state.mutedIssues.includes(i.id)).length;
  const attention = users.filter(hasIssues).length;
  const me = MEMBERS[2];
  return (
    <Sidebar
      fontClass={fontClass}
      label="Developer portal"
      identity={
        <>
          <ProjectPicker label="Project" options={PROJECTS} value={state.project} onChange={(project) => update((s) => ({ ...s, project }))} />
          <Segmented label="Environment" options={ENVS.map((e) => e.label)} value={ENVS.findIndex((e) => e.value === state.env)} onChange={(i) => update((s) => ({ ...s, env: ENVS[i].value }))} />
          <FindAnything />
        </>
      }
      foot={<AccountRow name={me.name} org={COMPANY.name} />}
    >
      {GROUPS.map((group) => (
        <NavGroup key={group.label ?? "top"} label={group.label}>
          {group.items.map((item) => {
            const href = BASE + item.href;
            const active = item.href === "" ? pathname === BASE : pathname.startsWith(href);
            const alert = item.href === "/issues" ? openIssues : item.href === "/users" ? attention : undefined;
            const alertLabel = item.href === "/issues" ? "Open issues" : "Users needing attention";
            return <NavRow key={item.href} href={href} icon={item.icon} label={item.label} active={active} alert={alert} alertLabel={alertLabel} />;
          })}
        </NavGroup>
      ))}
    </Sidebar>
  );
}

export function PortalShell({ fontClass, children }: { fontClass?: string; children: ReactNode }) {
  return (
    <PortalFrame rootClass={shell.root} sidebar={<PortalSidebar fontClass={fontClass} />}>
      {children}
    </PortalFrame>
  );
}
