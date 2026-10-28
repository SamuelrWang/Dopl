"use client";

/**
 * The developer portal's own layout: a full-page white app with a left nav (org / project, the
 * test/live switch, the sections), a top bar, and the section's page below. Built from the kit
 * (tokens, `SelectMenu` for the env beside the project name, `StatusPill`, the menu-row highlight); it is a standalone portal,
 * not the desktop /home frame.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Activity,
  Cpu,
  FlaskConical,
  KeyRound,
  LayoutGrid,
  Link2,
  SlidersHorizontal,
  Users,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import type { Environment } from "@dopl/device-contracts";
import { cn } from "@/shared/lib/utils";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import { SelectMenu } from "@/shared/ui/select-menu";
import { StatusPill } from "@/shared/ui/status-pill";
import { DEMO_ORG, DEMO_PROJECT } from "../_data/fixtures";
import { usePortal } from "./portal-context";

export const PORTAL_BASE = "/playground/developers";

/** Every portal section, in nav order. `connect` is the end user's screen, not a console page. */
export const PORTAL_SECTIONS: ReadonlyArray<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "", label: "Overview", icon: LayoutGrid },
  { href: "/keys", label: "API keys", icon: KeyRound },
  { href: "/users", label: "End users", icon: Users },
  { href: "/devices", label: "Devices", icon: Cpu },
  { href: "/profiles", label: "Context profiles", icon: SlidersHorizontal },
  { href: "/events", label: "Events", icon: Activity },
  { href: "/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/test-mode", label: "Test mode", icon: FlaskConical },
  { href: "/connect", label: "Connect customization", icon: Link2 },
];

const ENV_OPTIONS = [
  { value: "test", label: "Test" },
  { value: "live", label: "Live" },
] as const satisfies ReadonlyArray<{ value: Environment; label: string }>;

function useSection() {
  const pathname = usePathname();
  // A sub-route (`/devices/even_g2`) keeps its section selected.
  return PORTAL_SECTIONS.find((s) => s.href && pathname.startsWith(PORTAL_BASE + s.href)) ?? PORTAL_SECTIONS[0];
}

export function PortalShell({ children }: { children: ReactNode }) {
  return (
    // Fixed full-viewport white surface: the shell paints the dark frame on <body> for
    // non-workspace roots (the `/connect/[token]` pattern).
    <div className="fixed inset-0 z-50 flex bg-bg-overlay text-body text-text-secondary">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-3.5 px-8 pb-16 pt-7">{children}</div>
        </main>
      </div>
    </div>
  );
}

function Sidebar() {
  const { env, setEnv } = usePortal();
  const current = useSection();
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-5 border-r border-border-default bg-home-card px-3 py-4">
      <div className="flex flex-col gap-0.5 px-2">
        <span className="text-caption text-text-muted">{DEMO_ORG.name}</span>
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className={cn(IDENTITY_NAME_TEXT, "truncate")}>{DEMO_PROJECT.name}</span>
          <SelectMenu variant="outline" options={ENV_OPTIONS} value={env} onChange={setEnv} ariaLabel="Environment" />
        </span>
      </div>
      <nav aria-label="Developer portal" className="flex flex-col gap-0.5">
        {PORTAL_SECTIONS.map((s) => {
          const active = s === current;
          const Icon = s.icon;
          return (
            <Link
              key={s.href}
              href={PORTAL_BASE + s.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-field px-2 text-body transition-colors",
                active
                  ? "bg-menu-item-hover-bg font-medium text-text-primary"
                  : "text-text-secondary hover:bg-menu-item-hover-bg hover:text-text-primary"
              )}
            >
              <Icon size={15} strokeWidth={1.8} aria-hidden="true" className={active ? "text-text-primary" : "text-text-muted"} />
              {s.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

function TopBar() {
  const { env } = usePortal();
  const current = useSection();
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border-default px-8">
      <div className="flex min-w-0 items-center gap-2 text-body">
        <span className="text-text-muted">{DEMO_ORG.name}</span>
        <span className="text-text-disabled">/</span>
        <span className="text-text-muted">{DEMO_PROJECT.name}</span>
        <span className="text-text-disabled">/</span>
        <span className="font-medium text-text-primary">{current.label}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-micro text-text-muted">API {DEMO_PROJECT.api_version}</span>
        {env === "test" ? (
          <StatusPill tone="attention" dot>
            Test data
          </StatusPill>
        ) : (
          <StatusPill tone="live" dot bare>
            Live
          </StatusPill>
        )}
      </div>
    </header>
  );
}
