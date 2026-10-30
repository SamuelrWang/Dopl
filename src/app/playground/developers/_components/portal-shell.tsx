"use client";

/** /home's frame: the account rail, then one panel with a two-item sidebar and the record pane. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { LayoutGrid, ScrollText, type LucideIcon } from "lucide-react";
import { HomeFrame } from "@/features/home/components/shell/home-frame";
import { AccountRailCore } from "@/shared/layout/app-shell/account-rail-core";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import { cn } from "@/shared/lib/utils";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import type { Env } from "../_data/logs";
import { usePortal } from "./portal-store";
import { BASE } from "./ui";

const WORKSPACE = { id: "ws_larkfield", name: "Larkfield", slug: "larkfield", publicId: "lrkfld", iconUrl: null, role: "owner" as const };

const ENV_OPTIONS: { key: Env; label: string }[] = [
  { key: "test", label: "Test" },
  { key: "live", label: "Live" },
];

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: BASE, label: "Dashboard", icon: LayoutGrid },
  { href: `${BASE}/logs`, label: "Logs", icon: ScrollText },
];

function Sidebar() {
  const pathname = usePathname();
  const { state, update } = usePortal();
  return (
    <div className="flex w-52 shrink-0 flex-col gap-3 px-3 pb-3">
      <span className={cn(IDENTITY_NAME_TEXT, "truncate px-2.5 pt-1")}>Larkfield Assist</span>
      <SegmentedControl
        variant="track"
        size="md"
        ariaLabel="Environment"
        options={ENV_OPTIONS}
        value={state.env}
        onChange={(env) => update((s) => ({ ...s, env }))}
        className="w-full [&>button]:flex-1"
      />
      <nav aria-label="Developer portal" className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-field px-2.5 text-body transition-colors",
                active ? "bg-surface-cta font-medium text-text-on-cta" : "text-text-secondary hover:bg-menu-item-hover-bg hover:text-text-primary"
              )}
            >
              <Icon size={14} strokeWidth={1.8} aria-hidden="true" className={active ? undefined : "text-text-muted"} />
              {label}
            </Link>
          );
        })}
      </nav>
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
            markSrc="/favicons/android-chrome-512x512.png"
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
