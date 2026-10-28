"use client";

/**
 * The real developer portal's frame (W1.3): left nav (project picker, test/live switch, sections),
 * top bar, page below. The look is the `/playground/developers` demo's shell, built from the same
 * kit pieces; the data is the caller's own, read on the server and passed in. Every choice here
 * is a URL change, so the server re-reads for it.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Activity, KeyRound, type LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import { SelectMenu } from "@/shared/ui/select-menu";
import { StatusPill } from "@/shared/ui/status-pill";
import {
  EMPTY_FILTERS,
  portalQuery,
  type PortalParams,
  type PortalProject,
} from "@/features/device-sdk/portal/scope";

export const DEVELOPERS_BASE = "/developers";

const SECTIONS: ReadonlyArray<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/logs", label: "Request log", icon: Activity },
  { href: "/keys", label: "API keys", icon: KeyRound },
];

const ENV_OPTIONS = [
  { value: "test", label: "Test" },
  { value: "live", label: "Live" },
] as const;

export function PortalFrame({
  projects,
  params,
  title,
  children,
}: {
  projects: PortalProject[];
  params: PortalParams;
  title: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const current = projects.find((p) => p.id === params.project) ?? null;
  // Switching project or env keeps the section and drops the log's filters (they name rows of the
  // old scope).
  const go = (next: Partial<Pick<PortalParams, "project" | "env">>) =>
    router.push(`${pathname}?${portalQuery({ ...params, ...next, filters: { ...EMPTY_FILTERS } })}`);
  const sectionHref = (href: string) =>
    `${DEVELOPERS_BASE}${href}?${portalQuery({ ...params, filters: { ...EMPTY_FILTERS } })}`;

  const projectOptions = [
    ...projects.map((p) => ({
      value: p.id,
      label: p.name,
      description: p.org.internal ? `${p.org.name} · internal` : p.org.name,
    })),
    { value: "all", label: "All projects" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex bg-bg-overlay text-body text-text-secondary">
      <aside className="flex w-60 shrink-0 flex-col gap-5 border-r border-border-default bg-home-card px-3 py-4">
        <div className="flex flex-col gap-1.5 px-2">
          <span className="text-caption text-text-muted">{current ? current.org.name : "Developers"}</span>
          <SelectMenu
            variant="raisedField"
            options={projectOptions}
            value={params.project}
            onChange={(project) => go({ project })}
            ariaLabel="Project"
            disabled={projects.length === 0}
          />
          <SelectMenu
            variant="outline"
            options={ENV_OPTIONS}
            value={params.env}
            onChange={(env) => go({ env })}
            ariaLabel="Environment"
          />
        </div>
        <nav aria-label="Developer portal" className="flex flex-col gap-0.5">
          {SECTIONS.map((s) => {
            const active = pathname.startsWith(DEVELOPERS_BASE + s.href);
            const Icon = s.icon;
            return (
              <Link
                key={s.href}
                href={sectionHref(s.href)}
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
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border-default px-8">
          <div className="flex min-w-0 items-center gap-2 text-body">
            <span className="text-text-muted">{current ? current.name : "All projects"}</span>
            <span className="text-text-disabled">/</span>
            <span className={cn(IDENTITY_NAME_TEXT, "truncate")}>{title}</span>
          </div>
          <div className="flex items-center gap-3">
            {current && <span className="font-mono text-micro text-text-muted">API {current.apiVersion}</span>}
            {current?.org.internal && <StatusPill>Internal</StatusPill>}
            {params.env === "test" ? (
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
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-3.5 px-8 pb-16 pt-7">{children}</div>
        </main>
      </div>
    </div>
  );
}
