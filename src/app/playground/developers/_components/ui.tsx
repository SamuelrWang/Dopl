/**
 * Small presentational bits the portal sections share. Kit classes and tokens only
 * (docs/DESIGN-SYSTEM.md); no hand-rolled colours.
 */
import type { ReactNode } from "react";
import type { RiskTier } from "@dopl/contracts/device-sdk";
import { cn } from "@/shared/lib/utils";
import { IDENTITY_NAME_TEXT, LABEL_TEXT_MUTED, SECTION_HEADING_TEXT } from "@/shared/ui/section-heading";
import { DEMO_NOW } from "../_data/fixtures";

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h1 className={SECTION_HEADING_TEXT}>{title}</h1>
      {action}
    </div>
  );
}

/** A white card with an optional 14px title row. */
export function Card({ title, aside, children, className }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("white-card flex min-w-0 flex-col gap-3 p-4", className)}>
      {title && (
        <div className="flex items-center justify-between gap-3">
          <h2 className={IDENTITY_NAME_TEXT}>{title}</h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="white-card flex min-w-0 flex-col gap-1.5 p-4">
      <span className={LABEL_TEXT_MUTED}>{label}</span>
      <span className="font-mono text-stat tabular-nums text-text-primary">{value}</span>
      {sub && <span className="text-caption text-text-secondary">{sub}</span>}
    </div>
  );
}

/** A plain table on a white card: hairline header, hairline rows. */
export function Table({ columns, children }: { columns: string[]; children: ReactNode }) {
  return (
    <div className="white-card min-w-0 overflow-x-auto">
      <table className="w-full border-collapse text-left text-body">
        <thead>
          <tr className="border-b border-border-default">
            {columns.map((c) => (
              <th key={c} className={cn(LABEL_TEXT_MUTED, "whitespace-nowrap px-3 py-2.5 font-semibold")}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className, mono }: { children: ReactNode; className?: string; mono?: boolean }) {
  return <td className={cn("px-3 py-2.5 align-top text-text-primary", mono && "font-mono text-small", className)}>{children}</td>;
}

/** A small grey chip: scopes, capabilities, ids. */
export function Chip({ children, mono = true }: { children: ReactNode; mono?: boolean }) {
  return (
    <span className={cn("inline-flex items-center rounded-full bg-bg-inset px-2 py-0.5 text-caption text-text-secondary", mono && "font-mono")}>
      {children}
    </span>
  );
}

const TIER_TONE: Record<RiskTier, string> = {
  T0: "text-text-secondary",
  T1: "text-text-secondary",
  T2: "text-caution",
  T3: "text-warning",
  T4: "text-danger",
};

export function TierChip({ tier }: { tier: RiskTier }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border border-border-default px-1.5 py-px font-mono text-micro font-semibold", TIER_TONE[tier])}>
      {tier}
    </span>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-caption text-text-muted">{children}</span>;
}

/** "3m ago" / "2d ago" / "in 4d", measured from the demo clock. */
export function since(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.parse(DEMO_NOW) - Date.parse(iso);
  const future = diff < 0;
  const m = Math.abs(diff) / 60_000;
  const word = m < 1 ? "now" : m < 60 ? `${Math.round(m)}m` : m < 60 * 24 ? `${Math.round(m / 60)}h` : `${Math.round(m / (60 * 24))}d`;
  if (word === "now") return "Just now";
  return future ? `in ${word}` : `${word} ago`;
}

export function clock(iso: string): string {
  return iso.slice(5, 10) + " " + iso.slice(11, 19);
}

export const KIND_LABEL: Record<string, string> = {
  glasses: "Glasses",
  phone: "Phone",
  desktop: "Desktop",
  watch: "Watch",
  home_hub: "Home hub",
  home_device: "Home device",
  vehicle: "Vehicle",
  robot: "Robot",
};

export function deviceName(d: { adapter_id: string; kind: string; model: string }): string {
  if (d.adapter_id === "simulator") return `Simulated ${KIND_LABEL[d.kind]?.toLowerCase() ?? d.kind}`;
  if (d.model === "even_g2") return "Even G2";
  if (d.kind === "desktop") return "Dopl desktop";
  return d.model;
}
