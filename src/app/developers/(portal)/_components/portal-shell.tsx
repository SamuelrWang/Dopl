"use client";

/** The portal: the sidebar and the page's content, on one surface. No rail, no panel around either. */
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Activity, AlertCircle, BarChart3, Cpu, FlaskConical, KeyRound, LayoutGrid, Link2, Users, UsersRound, Webhook, type LucideIcon } from "lucide-react";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import { NavRow, SegmentedBy } from "../_design/ui";
import { AccountRow, NavGroup, PortalFrame, ProjectSwitcher, Sidebar } from "../_design/ui-sidebar";
import { FindAnything, type FindEntry } from "./find-anything";
import { BASE } from "./format";
import { usePortal, useLiveRefresh } from "./portal-store";

const ENVS = [
  { key: "live", label: "Live" },
  { key: "test", label: "Test" },
] as const;

type NavItem = { href: string; label: string; icon: LucideIcon };

const GROUPS: { label: string | null; items: NavItem[] }[] = [
  { label: null, items: [{ href: "", label: "Overview", icon: LayoutGrid }] },
  {
    label: "Build",
    items: [
      { href: "/devices", label: "Devices", icon: Cpu },
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
      { href: "/connect", label: "Connect page", icon: Link2 },
      { href: "/keys", label: "API keys", icon: KeyRound },
      { href: "/webhooks", label: "Webhooks", icon: Webhook },
      { href: "/usage", label: "Usage", icon: BarChart3 },
      { href: "/team", label: "Team", icon: UsersRound },
    ],
  },
];

interface ShellCounts {
  issues: number;
  attention: number;
  find: FindEntry[];
}

function PortalSidebar({ fontClass, counts }: { fontClass?: string; counts: ShellCounts }) {
  const pathname = usePathname();
  const { email, project, projects, env, setEnv, setProject } = usePortal();
  useLiveRefresh();
  const options = projects.map((p) => ({ value: p.id, label: p.name }));
  return (
    <Sidebar
      fontClass={fontClass}
      label="Developer portal"
      identity={
        <>
          <ProjectSwitcher label="Project" options={options} value={project.id} onChange={setProject} />
          <SegmentedBy label="Environment" options={ENVS} value={env} onChange={setEnv} />
          <FindAnything entries={counts.find} />
        </>
      }
      foot={<AccountRow name={email ?? "Signed in"} org={project.org.name} />}
    >
      {GROUPS.map((group) => (
        <NavGroup key={group.label ?? "top"} label={group.label}>
          {group.items.map((item) => {
            const href = BASE + item.href;
            const active = item.href === "" ? pathname === BASE : pathname.startsWith(href);
            const alert = item.href === "/issues" ? counts.issues : item.href === "/users" ? counts.attention : undefined;
            const alertLabel = item.href === "/issues" ? "Open issues" : "Users needing attention";
            return <NavRow key={item.href} href={href} icon={item.icon} label={item.label} active={active} alert={alert} alertLabel={alertLabel} />;
          })}
        </NavGroup>
      ))}
    </Sidebar>
  );
}

export function PortalShell({ fontClass, counts, children }: { fontClass?: string; counts: ShellCounts; children: ReactNode }) {
  return (
    <PortalFrame rootClass={shell.root} sidebar={<PortalSidebar fontClass={fontClass} counts={counts} />}>
      {children}
    </PortalFrame>
  );
}
