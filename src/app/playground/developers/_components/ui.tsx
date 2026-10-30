/**
 * The portal's page chrome and small bits, all composed from kit parts: the /home Overview's card,
 * strip and row classes, `.rail-layout`, `Breadcrumb`, underline tabs, `StatusPill`. Components
 * only; no colour, size or shadow is declared here.
 */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import type { RiskTier } from "@dopl/device-contracts";
import { Bot, Car, Glasses, House, Laptop, Smartphone, type LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Breadcrumb, type BreadcrumbItem } from "@/shared/ui/breadcrumb";
import { IdentityFace } from "@/shared/ui/identity-face";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { SECTION_HEADING_TEXT } from "@/shared/ui/section-heading";
import { SelectMenu } from "@/shared/ui/select-menu";
import { StatusPill } from "@/shared/ui/status-pill";
import ov from "@/features/home/components/overview/overview.module.css";
import { DEMO_NOW } from "../_data/company";
import { POLICY_LABEL, TIER_LABEL, trail, type IntegrationStatus, type ModelId } from "../_data/catalog";
import { RISK_TIER_DEFAULT_POLICY } from "@dopl/device-contracts";
import type { DeviceState } from "../_data/users";
import { STATE_LABEL } from "../_data/users";
import { usePortal } from "./portal-store";

export { OverviewCard as Card, Bars } from "@/features/home/components/overview/overview-card";
export { ov };

export const BASE = "/playground/developers";

const KIND_ICON: Record<string, LucideIcon> = {
  glasses: Glasses,
  desktop: Laptop,
  phone: Smartphone,
  home_hub: House,
  home_device: House,
  vehicle: Car,
  robot: Bot,
  watch: Smartphone,
};

/** A category's mark, the Overview's raised tile. */
export function TypeMark({ kind, size = "m" }: { kind: string; size?: "s" | "m" }) {
  const Icon = KIND_ICON[kind] ?? Bot;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "raised-tab flex shrink-0 items-center justify-center rounded-md text-text-secondary",
        size === "m" ? "h-7 w-7" : "h-5 w-5"
      )}
    >
      <Icon size={size === "m" ? 15 : 12} strokeWidth={1.8} />
    </span>
  );
}

export interface PortalPageProps {
  crumbs?: { label: string; href?: string }[];
  title: ReactNode;
  lead?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  tabs?: { key: string; label: string; count?: number }[];
  tab?: string;
  onTab?: (key: string) => void;
  /** The right rail: a live preview, or the side panel for one call. */
  aside?: ReactNode;
  asideWidth?: number;
  children: ReactNode;
}

/** One page: crumbs, title, tabs on a hairline, then a body and an optional rail that scroll apart. */
export function PortalPage({ crumbs, title, lead, meta, actions, tabs, tab, onTab, aside, asideWidth = 400, children }: PortalPageProps) {
  const router = useRouter();
  const { state } = usePortal();
  const items: BreadcrumbItem[] | null = crumbs
    ? crumbs.map((c) => ({ key: c.label, label: c.label, onSelect: c.href ? () => router.push(c.href!) : undefined }))
    : null;
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className={cn("flex shrink-0 flex-col gap-2 px-5 pt-4", !tabs && "pb-1")}>
        {items && <Breadcrumb items={items} />}
        <div className="flex min-h-9 items-center gap-3">
          {lead}
          <div className="flex min-w-0 flex-col">
            <h1 className={cn(SECTION_HEADING_TEXT, "truncate")}>{title}</h1>
            {meta && <div className="flex min-w-0 items-center gap-2 text-caption text-text-muted">{meta}</div>}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {state.env === "test" && (
              <StatusPill tone="attention" dot>
                Test data
              </StatusPill>
            )}
            {actions}
          </div>
        </div>
        {tabs && tab && onTab && (
          <SegmentedControl variant="underline" options={tabs} value={tab} onChange={onTab} ariaLabel="Sections" className="border-b border-border-default" />
        )}
      </header>
      <div className="rail-layout">
        <div
          className="rail-layout-cols"
          data-rail={aside ? undefined : "off"}
          style={aside ? ({ "--rail-layout-w": `${asideWidth}px` } as CSSProperties) : undefined}
        >
          <div className="rail-layout-main">
            <div className="mx-auto flex w-full max-w-270 flex-col gap-3.5 px-2 pb-5 pt-1">{children}</div>
          </div>
          {aside && <div aria-hidden="true" />}
          {aside && <aside className="rail-layout-aside">{aside}</aside>}
        </div>
      </div>
    </div>
  );
}

export function Strip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className={cn("white-card", ov.card, ov.strip)} aria-label={label}>
      {children}
    </section>
  );
}

export function Cell({ label, value, of, sub, href }: { label: string; value: string; of?: string; sub?: ReactNode; href?: string }) {
  const body = (
    <>
      <span className={ov.cellLabel}>{label}</span>
      <span className={ov.figure}>
        {value}
        {of && <span className={ov.of}>{of}</span>}
      </span>
      {sub && <span className={ov.rowMeta}>{sub}</span>}
    </>
  );
  return href ? (
    <Link href={href} className={cn(ov.cell, "transition-colors hover:bg-menu-item-hover-bg")}>
      {body}
    </Link>
  ) : (
    <div className={ov.cell}>{body}</div>
  );
}

/** Label-over-value facts in a grey well inside a white card. */
export function Facts({ facts, cols = 4 }: { facts: [string, ReactNode][]; cols?: 2 | 3 | 4 }) {
  const grid = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" }[cols];
  return (
    <dl className={cn("card-well grid gap-x-4 gap-y-2.5 px-3.5 py-3", grid)}>
      {facts.map(([k, v]) => (
        <div key={k} className="flex min-w-0 flex-col gap-0.5">
          <dt className={ov.cellLabel}>{k}</dt>
          <dd className="truncate text-small font-medium text-text-primary">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** An id is small secondary text: human names lead. */
export function Id({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("truncate font-mono text-micro text-text-muted", className)}>{children}</span>;
}

/** The identity card's one-concept fact chip: a device, a grant, a scope. */
export function FactChip({ icon, children, tone, title }: { icon?: ReactNode; children: ReactNode; tone?: "attention"; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-tile border border-border-default bg-bg-elevated px-2 text-caption text-text-primary",
        tone === "attention" && "text-warning"
      )}
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** A dot in the device's state colour: green only for online, amber only when it needs attention. */
export function StateDot({ state }: { state: DeviceState }) {
  const needs = state === "stale" || state === "needs_relink";
  return (
    <span className="status-pill" data-tone={state === "online" ? "live" : needs ? "attention" : "neutral"} data-bare="true" title={STATE_LABEL[state]}>
      <span className="status-pill-dot" aria-hidden="true" />
    </span>
  );
}

export function StatePill({ state }: { state: DeviceState }) {
  if (state === "online") {
    return (
      <StatusPill tone="live" dot bare>
        Online
      </StatusPill>
    );
  }
  if (state === "offline") return <StatusPill>Offline</StatusPill>;
  return (
    <StatusPill tone="attention" dot>
      {STATE_LABEL[state]}
    </StatusPill>
  );
}

/** Category › Integration › Model, under a physical device's name. */
export function ModelTrail({ modelId, className }: { modelId: ModelId; className?: string }) {
  return <span className={cn("truncate text-caption text-text-muted", className)}>{trail(modelId).join(" › ")}</span>;
}

export function IntegrationStatusPill({ status }: { status: IntegrationStatus }) {
  return status === "live" ? (
    <StatusPill tone="live" dot bare>
      Live
    </StatusPill>
  ) : (
    <StatusPill>Testing</StatusPill>
  );
}

export function TierChip({ tier }: { tier: RiskTier }) {
  return (
    <span title={`${TIER_LABEL[tier]}. ${POLICY_LABEL[RISK_TIER_DEFAULT_POLICY[tier]]}`}>
      <StatusPill tone={tier === "T4" ? "attention" : "neutral"} className="font-mono">
        {tier}
      </StatusPill>
    </span>
  );
}

export function UserFace({ name, online }: { name: string; online?: boolean }) {
  return <IdentityFace size="s" name={name} online={online} />;
}

/** A hairline list inside a white card with no title, the Tasks list. */
export function RowList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn("white-card m-0 flex min-w-0 list-none flex-col px-3", className)}>{children}</ul>;
}

/** A small filter: the Overview's outlined select with its name as a muted prefix. */
export function Filter<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return <SelectMenu variant="outline" prefix={label} ariaLabel={label} value={value} options={options} onChange={onChange} />;
}

/** "3m ago" / "2d ago", measured from the demo clock. */
export function since(iso: string | null): string {
  if (!iso) return "Never";
  const m = (Date.parse(DEMO_NOW) - Date.parse(iso)) / 60_000;
  if (m < 1) return "Just now";
  if (m < 60) return `${Math.round(m)}m ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / (60 * 24))}d ago`;
}

export const fmt = (n: number) => n.toLocaleString("en-US");

export function clock(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "UTC" });
  return `${date}, ${time}`;
}

export function ms(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return n < 1000 ? `+${n} ms` : `+${(n / 1000).toFixed(1)} s`;
}
