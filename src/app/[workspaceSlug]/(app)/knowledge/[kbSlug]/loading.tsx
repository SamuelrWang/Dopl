import { cn } from "@/shared/lib/utils";
import styles from "@/shared/layout/app-shell/app-shell.module.css";

/**
 * Route-level loading boundary for the KB detail page. Renders INSIDE
 * the persistent knowledge-layout shell (rail + sidebar stay mounted),
 * so this is an in-panel skeleton mirroring KnowledgeBaseView's
 * geometry — header bar, tree pane, floating doc panel — to avoid any
 * full-screen flash when switching knowledge bases.
 */
export default function Loading() {
  return (
    <main className={cn(styles.mainDetail, styles.lightScope)}>
      <div className="flex h-full min-h-0 flex-1 flex-col animate-pulse">
        {/* Header bar */}
        <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border-subtle px-5">
          <Bar className="h-3.5 w-32" />
          <Bar className="h-3.5 w-3.5 rounded-full" />
          <Bar className="h-3.5 w-40" />
          <div className="ml-auto flex items-center gap-2">
            <Bar className="hidden md:block h-7 w-56 rounded-md" />
            <Bar className="h-7 w-20 rounded-md" />
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Tree pane */}
          <aside className="hidden md:flex w-72 shrink-0 flex-col border-r border-border-subtle px-3 py-3 gap-2.5">
            <Bar className="h-7 w-full rounded-md mb-2" />
            {TREE_ROW_WIDTHS.map((w, i) => (
              <Bar
                key={i}
                className="h-3.5 rounded"
                style={{ width: w, marginLeft: i % 3 === 2 ? 16 : 0 }}
              />
            ))}
          </aside>

          {/* Doc pane: floating header panel + paragraph lines */}
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="mx-6 mt-4 mb-1 max-w-3xl rounded-xl border border-border-default bg-surface-raised-1 px-5 pt-4 pb-3">
              <Bar className="h-6 w-64 rounded mb-3" />
              <Bar className="h-3 w-full rounded mb-1.5" />
              <Bar className="h-3 w-2/3 rounded" />
            </div>
            <div className="max-w-3xl px-6 pt-5 flex flex-col gap-2.5">
              {DOC_LINE_WIDTHS.map((w, i) => (
                <Bar key={i} className="h-3.5 rounded" style={{ width: w }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

const TREE_ROW_WIDTHS = [
  "70%", "55%", "62%", "48%", "66%", "58%", "44%", "60%", "52%", "68%",
];
const DOC_LINE_WIDTHS = [
  "42%", "96%", "88%", "92%", "60%", "0%", "78%", "94%", "85%", "70%",
];

function Bar({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={cn("bg-surface-raised-3", className)}
      style={style}
      aria-hidden
    />
  );
}
