import type { ReactNode } from "react";
import { SECTION_HEADING_TEXT } from "@/shared/ui/section-heading";

export { OverviewCard as Card, Bars } from "@/features/home/components/overview/overview-card";
export { default as ov } from "@/features/home/components/overview/overview.module.css";

export const BASE = "/playground/developers";

/** One page: its title and a scrolling, centred column. */
export function PortalPage({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-200 flex-col gap-3.5 px-5 pb-7 pt-4">
        <header className="flex min-h-9 items-center justify-between gap-3">
          <h1 className={SECTION_HEADING_TEXT}>{title}</h1>
          {actions}
        </header>
        {children}
      </div>
    </div>
  );
}

export const fmt = (n: number) => n.toLocaleString("en-US");

export function clock(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  return `${date}, ${time}`;
}
