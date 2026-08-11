"use client";

/**
 * Slim inline cap strip for a capped Starter workspace: a quiet near-cap
 * label at ≥90%, a warning-toned strip once creates are frozen. Both
 * offer the upgrade prompt; nothing is ever deleted. Rendered by the
 * ontology kanban (OntologyView).
 */
export function CapNotice({
  used,
  cap,
  over,
  onUpgrade,
}: {
  used: number;
  cap: number;
  over: boolean;
  onUpgrade: () => void;
}) {
  const nearCap = used / cap >= 0.9;
  if (!over && !nearCap) return null;

  if (over) {
    return (
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-warning/25 bg-warning/10 px-3 py-1.5 text-caption">
        <span className="text-warning">
          {used.toLocaleString()} / {cap.toLocaleString()} objects (cards and columns) —
          new objects are paused on Starter (nothing was deleted; reads and edits still
          work).
        </span>
        <button
          type="button"
          onClick={onUpgrade}
          className="shrink-0 cursor-pointer font-semibold text-warning underline"
        >
          Upgrade for unlimited
        </button>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle bg-card-surface-subtle px-3 py-1.5 text-caption">
      <span className="text-text-secondary">
        {used.toLocaleString()} / {cap.toLocaleString()} objects on Starter
      </span>
      <button
        type="button"
        onClick={onUpgrade}
        className="shrink-0 cursor-pointer font-semibold text-link"
      >
        Upgrade for unlimited
      </button>
    </div>
  );
}
