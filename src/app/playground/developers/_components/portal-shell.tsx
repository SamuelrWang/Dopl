"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { Environment } from "@dopl/contracts/device-sdk";
import { cn } from "@/shared/lib/utils";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { StatusPill } from "@/shared/ui/status-pill";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import { DEMO_ORG, DEMO_PROJECT } from "../_data/fixtures";
import { usePortal } from "./portal-context";

export const PORTAL_BASE = "/playground/developers";

/** Every portal section, in rail order. `connect` is the end user's screen, not a console page. */
export const PORTAL_SECTIONS = [
  { href: "", label: "Overview" },
  { href: "/keys", label: "API keys" },
  { href: "/users", label: "End users" },
  { href: "/devices", label: "Devices" },
  { href: "/profiles", label: "Context profiles" },
  { href: "/events", label: "Events" },
  { href: "/webhooks", label: "Webhooks" },
  { href: "/test-mode", label: "Test mode" },
  { href: "/connect", label: "Connect preview" },
] as const;

const ENV_OPTIONS = [
  { key: "test", label: "Test" },
  { key: "live", label: "Live" },
] as const satisfies ReadonlyArray<{ key: Environment; label: string }>;

export function PortalShell({ children }: { children: ReactNode }) {
  return (
    // Fixed full-viewport white surface: the shell paints the dark frame on <body> for
    // non-workspace roots (the `/connect/[token]` pattern).
    <main className="fixed inset-0 z-50 overflow-y-auto bg-bg-overlay">
      <Header />
      <div className="mx-auto flex w-full max-w-6xl gap-8 px-6 pb-16 pt-6">
        <Rail />
        <div className="flex min-w-0 flex-1 flex-col gap-5">{children}</div>
      </div>
    </main>
  );
}

function Header() {
  const { env, setEnv } = usePortal();
  return (
    <header className="sticky top-0 z-10 border-b border-border-default bg-bg-overlay">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-6">
        <div className="flex min-w-0 items-center gap-2 text-body">
          <span className="text-text-secondary">{DEMO_ORG.name}</span>
          <span className="text-text-disabled">/</span>
          <span className={IDENTITY_NAME_TEXT}>{DEMO_PROJECT.name}</span>
          <span className="ml-2 font-mono text-micro text-text-muted">{DEMO_PROJECT.api_version}</span>
        </div>
        <div className="flex items-center gap-3">
          {env === "test" && (
            <StatusPill tone="attention" dot>
              Test data
            </StatusPill>
          )}
          <SegmentedControl variant="track" options={ENV_OPTIONS} value={env} onChange={setEnv} ariaLabel="Environment" />
        </div>
      </div>
    </header>
  );
}

function Rail() {
  const pathname = usePathname();
  return (
    <nav aria-label="Developer portal" className="sticky top-20 flex h-fit w-44 shrink-0 flex-col gap-0.5">
      <span className="px-3 pb-2 text-label font-semibold uppercase tracking-wide text-text-muted">Developers</span>
      {PORTAL_SECTIONS.map((s) => {
        const href = PORTAL_BASE + s.href;
        const active = pathname === href;
        return (
          <Link
            key={s.href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-field px-3 py-1.5 text-body transition-colors",
              active ? "bg-surface-raised-2 font-medium text-text-primary" : "text-text-secondary hover:bg-surface-raised-1 hover:text-text-primary"
            )}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
