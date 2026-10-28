/**
 * The portal's presentational bits, composed from kit components and the Overview recipes
 * (`home/components/overview/overview.module.css`). Components only; no colour, size or shadow
 * is declared here. Server-safe: no hooks.
 */
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { SECTION_HEADING_TEXT } from "@/shared/ui/section-heading";
import ov from "@/features/home/components/overview/overview.module.css";

export { OverviewCard as Card } from "@/features/home/components/overview/overview-card";
export { ov };

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4 pb-1">
      <h1 className={SECTION_HEADING_TEXT}>{title}</h1>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}

/** The Overview's table: caption headers on a hairline, rows split by hairlines. */
export function Table({ columns, children }: { columns: Array<string | { label: string; num?: boolean }>; children: ReactNode }) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className={ov.table}>
        <thead>
          <tr>
            {columns.map((c, i) => {
              const col = typeof c === "string" ? { label: c } : c;
              return (
                <th key={col.label || `col-${i}`} scope="col" className={cn("whitespace-nowrap", col.num && ov.num)}>
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

/** Label-over-value facts in a well. */
export function Facts({ facts }: { facts: Array<[string, string]> }) {
  return (
    <dl className="card-well grid grid-cols-2 gap-x-4 gap-y-2.5 px-3.5 py-3">
      {facts.map(([k, v]) => (
        <div key={k} className="flex min-w-0 flex-col gap-0.5">
          <dt className={ov.cellLabel}>{k}</dt>
          <dd className="truncate font-mono text-small text-text-primary" title={v}>
            {v}
          </dd>
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

/** Shown when the signed-in account belongs to no developer org yet. */
export function NoProjects() {
  return (
    <EmptyState
      title="No developer projects yet"
      description="This account is not in a developer org. Ask an org owner to add you."
    />
  );
}
