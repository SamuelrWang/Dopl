import { clsx } from "clsx";
import { ExternalLink, Plus, Trash2 } from "lucide-react";

interface EntryCardProps {
  entryId: string;
  title: string;
  summary?: string | null;
  sourceUrl?: string | null;
  complexity?: string | null;
  onAddToCanvas?: (entryId: string) => void;
  onRemoveFromCanvas?: (entryId: string) => void;
  isOnCanvas?: boolean;
}

const complexityColors: Record<string, string> = {
  simple: "text-[var(--mint)]",
  moderate: "text-[var(--accent-primary)]",
  complex: "text-[var(--gold)]",
  advanced: "text-[var(--coral)]",
};

export function EntryCard({
  entryId,
  title,
  summary,
  sourceUrl,
  complexity,
  onAddToCanvas,
  onRemoveFromCanvas,
  isOnCanvas,
}: EntryCardProps) {
  return (
    <div className="glass-card p-3 space-y-2 transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-[var(--text-primary)] truncate">{title}</h4>
          {complexity && (
            <span className={clsx("mono-label", complexityColors[complexity] || "text-[var(--text-muted)]")}>
              {complexity}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition-colors"
              title="Open source"
            >
              <ExternalLink size={12} />
            </a>
          )}
          {onAddToCanvas && !isOnCanvas && (
            <button
              onClick={() => onAddToCanvas(entryId)}
              className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition-colors"
              title="Add to canvas"
            >
              <Plus size={12} />
            </button>
          )}
          {onRemoveFromCanvas && isOnCanvas && (
            <button
              onClick={() => onRemoveFromCanvas(entryId)}
              className="p-1 text-[var(--text-muted)] hover:text-[var(--coral)] transition-colors"
              title="Remove from canvas"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
      {summary && (
        <p className="text-xs text-[var(--text-secondary)] line-clamp-2">{summary}</p>
      )}
    </div>
  );
}
