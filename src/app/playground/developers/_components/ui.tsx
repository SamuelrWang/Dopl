/**
 * The portal's presentational bits, all composed from the /home Overview face's recipes
 * (`home/components/overview/overview.module.css`, `OverviewCard`) and the kit
 * (`StatusPill`, `.card-well`). No colour, size or shadow is declared here.
 */
import type { ReactNode } from "react";
import type { RiskTier } from "@dopl/contracts/device-sdk";
import { RISK_TIER_DEFAULT_POLICY } from "@dopl/contracts/device-sdk";
import { cn } from "@/shared/lib/utils";
import { StatusPill } from "@/shared/ui/status-pill";
import ov from "@/features/home/components/overview/overview.module.css";
import { DEMO_NOW } from "../_data/fixtures";

export { OverviewCard as Card, Bars } from "@/features/home/components/overview/overview-card";
export { ov };

/** A grey kit pill holding an identifier: a scope, a capability, a limit. */
export function Chip({ children, mono = true }: { children: ReactNode; mono?: boolean }) {
  return <StatusPill className={cn(mono && "font-mono")}>{children}</StatusPill>;
}

/** T3 and T4 ask the user on their device, so they take the "needs you" tone; the rest stay grey. */
export function TierChip({ tier }: { tier: RiskTier }) {
  return (
    <span title={RISK_TIER_DEFAULT_POLICY[tier]}>
      <StatusPill tone={tier === "T3" || tier === "T4" ? "attention" : "neutral"} className="font-mono">
        {tier}
      </StatusPill>
    </span>
  );
}

export function Chips({ children }: { children: ReactNode }) {
  return <span className="flex flex-wrap items-center gap-1 py-1.5">{children}</span>;
}

/** The Overview's summary strip: one white card, cells split by hairlines. */
export function Strip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className={cn("white-card", ov.card, ov.strip)} aria-label={label}>
      {children}
    </section>
  );
}

export function Cell({ label, value, of, sub }: { label: string; value: string; of?: string; sub?: string }) {
  return (
    <div className={ov.cell}>
      <span className={ov.cellLabel}>{label}</span>
      <span className={ov.figure}>
        {value}
        {of && <span className={ov.of}>{of}</span>}
      </span>
      {sub && <span className={ov.rowMeta}>{sub}</span>}
    </div>
  );
}

/** Label-over-value facts in a well. */
export function Facts({ facts, cols = 3 }: { facts: Array<[string, string]>; cols?: 2 | 3 }) {
  return (
    <dl className={cn("card-well grid gap-x-4 gap-y-2.5 px-3.5 py-3", cols === 3 ? "grid-cols-3" : "grid-cols-2")}>
      {facts.map(([k, v]) => (
        <div key={k} className="flex min-w-0 flex-col gap-0.5">
          <dt className={ov.cellLabel}>{k}</dt>
          <dd className="truncate font-mono text-small text-text-primary">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A JSON body in a well. */
export function Json({ value }: { value: unknown }) {
  return (
    <pre className="card-well overflow-x-auto px-3.5 py-3 font-mono text-caption leading-relaxed text-text-secondary">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** The Overview's table: caption headers on a hairline, 36px rows split by hairlines. */
export function Table({ columns, children }: { columns: Array<string | { label: string; num?: boolean }>; children: ReactNode }) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className={ov.table}>
        <thead>
          <tr>
            {columns.map((c) => {
              const col = typeof c === "string" ? { label: c } : c;
              return (
                <th key={col.label || "actions"} scope="col" className={cn("whitespace-nowrap", col.num && ov.num)}>
                  {col.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** A table cell's button that opens its row: the Overview's `.open`, whose `::after` covers the row. */
export function RowOpen({ label, expanded, onClick, children }: { label: string; expanded: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={cn(ov.open, "whitespace-nowrap")} aria-label={label} aria-expanded={expanded} onClick={onClick}>
      {children}
    </button>
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

/** The SDK's device kind as the product's glyph kind (`DeviceKindIcon`): a desktop is a computer. */
export const glyphKind = (kind: string): string => (kind === "desktop" ? "computer" : kind);

export function deviceName(d: { adapter_id: string; kind: string; model: string }): string {
  if (d.adapter_id === "simulator") return `Simulated ${KIND_LABEL[d.kind]?.toLowerCase() ?? d.kind}`;
  if (d.model === "even_g2") return "Even G2";
  if (d.kind === "desktop") return "Dopl desktop";
  return d.model;
}
