"use client";

import { useEffect, useRef, useState } from "react";
import { Filter, Check } from "lucide-react";

export interface ScopeOption {
  id: string;
  name: string;
}

export interface ScopeFilters {
  clusterIds?: string[];
  kbIds?: string[];
  skillIds?: string[];
}

interface ClusterScopePickerProps {
  clusters: ScopeOption[];
  knowledgeBases: ScopeOption[];
  skills: ScopeOption[];
  value: ScopeFilters | null;
  onChange: (next: ScopeFilters | null) => void;
}

/**
 * Header chip + popover used to narrow the private chat's read scope.
 *
 * `value === null` means "all" — no filtering. Selecting any subset
 * flips to a non-null filter object the route handler passes through to
 * the workspace-knowledge / skills tools.
 */
export function ClusterScopePicker({
  clusters,
  knowledgeBases,
  skills,
  value,
  onChange,
}: ClusterScopePickerProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const isAll = value === null;
  const totalSelected =
    (value?.clusterIds?.length ?? 0) +
    (value?.kbIds?.length ?? 0) +
    (value?.skillIds?.length ?? 0);
  const summary = isAll
    ? "All workspace data"
    : totalSelected === 0
      ? "Nothing selected"
      : `${totalSelected} source${totalSelected === 1 ? "" : "s"}`;

  function toggleSelection(
    bucket: keyof ScopeFilters,
    pool: ScopeOption[],
    id: string
  ) {
    const current: ScopeFilters = isAll
      ? {
          clusterIds: clusters.map((c) => c.id),
          kbIds: knowledgeBases.map((k) => k.id),
          skillIds: skills.map((s) => s.id),
        }
      : {
          clusterIds: value?.clusterIds ?? [],
          kbIds: value?.kbIds ?? [],
          skillIds: value?.skillIds ?? [],
        };
    const list = current[bucket] ?? [];
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    const updated = { ...current, [bucket]: next };
    // If everything is selected, fall back to null (= unconstrained).
    const allSelected =
      (updated.clusterIds?.length ?? 0) === clusters.length &&
      (updated.kbIds?.length ?? 0) === knowledgeBases.length &&
      (updated.skillIds?.length ?? 0) === skills.length;
    onChange(allSelected ? null : updated);
    void pool; // pool is implied via the bucket — unused warning silencer
  }

  function selectAll() {
    onChange(null);
  }

  function selectNone() {
    onChange({ clusterIds: [], kbIds: [], skillIds: [] });
  }

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-text-secondary hover:bg-white/[0.04] hover:text-text-primary transition-colors cursor-pointer border border-white/[0.06]"
      >
        <Filter size={11} />
        <span className="truncate max-w-[160px]">Scope: {summary}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-[280px] rounded-lg border border-white/[0.1] bg-[var(--panel-surface,_#181818)] shadow-lg z-50 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
            <button
              type="button"
              onClick={selectAll}
              className="text-[11px] text-text-secondary hover:text-text-primary transition-colors"
            >
              All
            </button>
            <span className="text-[11px] text-text-secondary/40">·</span>
            <button
              type="button"
              onClick={selectNone}
              className="text-[11px] text-text-secondary hover:text-text-primary transition-colors"
            >
              None
            </button>
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            <PickerSection
              label="Clusters"
              options={clusters}
              selectedIds={
                isAll ? clusters.map((c) => c.id) : value?.clusterIds ?? []
              }
              onToggle={(id) => toggleSelection("clusterIds", clusters, id)}
            />
            <PickerSection
              label="Knowledge bases"
              options={knowledgeBases}
              selectedIds={
                isAll ? knowledgeBases.map((k) => k.id) : value?.kbIds ?? []
              }
              onToggle={(id) => toggleSelection("kbIds", knowledgeBases, id)}
            />
            <PickerSection
              label="Skills"
              options={skills}
              selectedIds={isAll ? skills.map((s) => s.id) : value?.skillIds ?? []}
              onToggle={(id) => toggleSelection("skillIds", skills, id)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PickerSection({
  label,
  options,
  selectedIds,
  onToggle,
}: {
  label: string;
  options: ScopeOption[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  if (options.length === 0) {
    return (
      <div className="px-3 py-2">
        <p className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/50 mb-1">
          {label}
        </p>
        <p className="text-[11px] text-text-secondary/40 italic">None.</p>
      </div>
    );
  }
  return (
    <div className="px-1 py-2 border-b border-white/[0.04] last:border-b-0">
      <p className="px-2 text-[10px] font-mono uppercase tracking-wider text-text-secondary/50 mb-1">
        {label}
      </p>
      {options.map((o) => {
        const checked = selectedIds.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onToggle(o.id)}
            className="w-full flex items-center gap-2 px-2 py-1 rounded-md text-left text-[12px] text-text-primary hover:bg-white/[0.04] transition-colors cursor-pointer"
          >
            <span
              className={
                "shrink-0 w-3.5 h-3.5 rounded-sm border flex items-center justify-center " +
                (checked
                  ? "bg-violet-300/30 border-violet-300/60"
                  : "border-white/[0.15]")
              }
            >
              {checked && <Check size={10} className="text-text-primary" />}
            </span>
            <span className="truncate">{o.name}</span>
          </button>
        );
      })}
    </div>
  );
}
