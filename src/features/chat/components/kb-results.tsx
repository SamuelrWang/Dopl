"use client";

interface KbResultItem {
  title: string;
  /** Short text snippet — first match window or the row's excerpt. */
  snippet: string;
  /** Optional secondary label rendered to the right (KB / source name). */
  source?: string;
  /** Optional link target. When omitted the row renders as plain text. */
  href?: string;
}

/**
 * Compact list of search-result rows nested inside an `<AgentRow>`'s
 * expanded body. Two layout variants:
 *
 *   • single-base — pass `base` and an items list. The base name renders
 *     once at the top and rows are bullets underneath.
 *   • mixed sources — omit `base` and put the per-row source on each
 *     item. Used by the workspace-knowledge tool when results span KBs.
 */
export function KbResults({
  base,
  items,
}: {
  base?: string;
  items: KbResultItem[];
}) {
  if (items.length === 0) {
    return (
      <p className="text-[11.5px] text-text-secondary/50 italic">
        No matches.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {base && (
        <p className="text-[10px] text-text-secondary/50 font-mono uppercase tracking-wider">
          {base}
        </p>
      )}
      {items.map((it, i) => {
        const inner = (
          <>
            <span className="mt-1.5 w-1 h-1 rounded-full bg-text-text-secondary/40 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] text-text-primary truncate">
                {it.title}
              </p>
              <p className="text-[11.5px] text-text-secondary/70 leading-relaxed line-clamp-2">
                {it.snippet}
              </p>
            </div>
            {it.source && !base && (
              <span className="shrink-0 text-[10px] text-text-secondary/40 font-mono">
                {it.source}
              </span>
            )}
          </>
        );
        return it.href ? (
          <a
            key={i}
            href={it.href}
            target="_blank"
            rel="noreferrer"
            className="flex items-start gap-3 hover:bg-surface-raised-1 rounded-md px-1 -mx-1 transition-colors"
          >
            {inner}
          </a>
        ) : (
          <div key={i} className="flex items-start gap-3">
            {inner}
          </div>
        );
      })}
    </div>
  );
}
