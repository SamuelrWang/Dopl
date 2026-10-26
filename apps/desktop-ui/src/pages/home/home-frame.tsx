import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import type { HomeTab } from "./home-tabs";
import home from "./home.module.css";

/**
 * /home's frame, shared by the page and its skeleton: the account rail, then one panel holding
 * the header strip, the channel column and the record pane. `face` picks the panel and pane
 * fills (`home.module.css`); `data-frame-skin` carries the pane's line into the channel surface.
 */
export function HomeFrame({
  face,
  rail,
  header,
  list,
  children,
}: {
  face: HomeTab;
  rail: ReactNode;
  header: ReactNode;
  list: ReactNode;
  /** What the record pane holds. */
  children: ReactNode;
}) {
  return (
    <div className={shell.body}>
      {rail}
      <div className={shell.surface}>
        {/* `!ml-0` puts the panel flush on the rail, so the dark column is exactly the rail. */}
        <main
          className={cn("page-float !ml-0 flex flex-1 flex-col overflow-hidden", home.page)}
          data-face={face}
        >
          {header}
          <div className="flex min-h-0 flex-1">
            {list}
            {/* Bounded by its line, no shadow: the pane has no top or left gap to cast into. */}
            <div
              className={cn(
                "mb-3 mr-3 flex min-w-0 flex-1 overflow-hidden rounded-[14px] border border-home-panel-line",
                home.pane
              )}
              data-frame-skin
            >
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * The header strip's cells. `lead` sits in the list-width cell so the tabs start on the record
 * pane's left edge; `pr-3` is the pane's `mr-3`, so the trail ends on its right edge.
 */
export function HomeHeaderRow({
  lead,
  tabs,
  trail,
}: {
  lead: ReactNode;
  tabs: ReactNode;
  trail: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 pr-3">
      <div className="flex min-w-0 items-center">
        <div className="flex w-[var(--home-list-w)] min-w-0 shrink-0 items-center px-3">
          {lead}
        </div>
        {tabs}
      </div>
      {/* Positioned: the search popup spans this group, pill-left to Profile-right. */}
      <div className="relative flex items-center gap-2.5">{trail}</div>
    </div>
  );
}

/** The channel column at the header cell's width; it scrolls inside the panel. */
export function HomeListColumn({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-[var(--home-list-w)] shrink-0 flex-col">
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3 pt-1">{children}</div>
    </div>
  );
}
