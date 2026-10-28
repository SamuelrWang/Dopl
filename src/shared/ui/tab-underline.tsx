import { cn } from "@/shared/lib/utils";

/**
 * THE TAB UNDERLINE — the selection mark of a switcher (/home's top tabs, a page's view tabs, the
 * profile rail, the agent window's tabs): a 2px ink rule at the bottom edge of the tab, further
 * below the label than a text link's underline, drawn on the selected tab only. Black, full-bleed
 * and square-ended, at the popup field's line thickness (`form-dialog.module.css › .line::after`,
 * pinned by `agent-window-frame.test.ts`). The tab must be `relative`.
 *
 * Every switcher draws it through `segmented-control.tsx › SegmentedControl variant="underline"`
 * or, where the tab is not a plain button (it holds a close ×), through {@link TabUnderline}.
 */
export const TAB_UNDERLINE =
  "pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-text-primary";

/** The rule as an element, for a selected tab. `className` is position or ink only. */
export function TabUnderline({ className }: { className?: string }) {
  return <span aria-hidden="true" data-tab-underline="" className={cn(TAB_UNDERLINE, className)} />;
}
