interface ClusterBadgeProps {
  name: string;
  count?: number;
}

export function ClusterBadge({ name, count }: ClusterBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium
      bg-[var(--accent-soft)]/30 text-[var(--accent-primary)] border border-[var(--accent-primary)]/20">
      {name}
      {count !== undefined && (
        <span className="text-[var(--text-muted)]">({count})</span>
      )}
    </span>
  );
}
