"use client";

import { GlassCard, GlassDivider, MonoLabel } from "@/shared/design";

interface FilterSidebarProps {
  useCase: string;
  complexity: string;
  onUseCaseChange: (value: string | null) => void;
  onComplexityChange: (value: string | null) => void;
  onReset: () => void;
}

const useCases = [
  "all",
  "cold_outbound",
  "lead_gen",
  "content_creation",
  "data_pipeline",
  "monitoring",
  "automation",
  "agent_system",
  "dev_tooling",
  "customer_support",
  "research",
  "other",
];

const complexities = ["all", "simple", "moderate", "complex", "advanced"];

const complexityAccent: Record<string, string> = {
  simple: "var(--mint)",
  moderate: "var(--gold)",
  complex: "var(--coral)",
  advanced: "var(--coral)",
};

function formatLabel(value: string): string {
  if (value === "all") return "All";
  return value.replace(/_/g, " ");
}

export function FilterSidebar({
  useCase,
  complexity,
  onUseCaseChange,
  onComplexityChange,
  onReset,
}: FilterSidebarProps) {
  const hasActiveFilters = useCase !== "all" || complexity !== "all";

  return (
    <GlassCard variant="subtle" label="Filters" labelDivider>
      {/* Use Case filter */}
      <div className="space-y-2">
        <MonoLabel tone="muted">Use Case</MonoLabel>
        <div className="space-y-0.5">
          {useCases.map((uc) => {
            const isActive = uc === useCase;
            return (
              <button
                key={uc}
                onClick={() => onUseCaseChange(uc)}
                className={`w-full text-left px-2 py-1.5 font-mono text-[10px] uppercase tracking-wide rounded-[3px] transition-colors ${
                  isActive
                    ? "bg-white/[0.08] text-white/90 border border-white/[0.15]"
                    : "text-white/40 hover:text-white/70 hover:bg-white/[0.04] border border-transparent"
                }`}
              >
                {formatLabel(uc)}
              </button>
            );
          })}
        </div>
      </div>

      <GlassDivider className="my-4" />

      {/* Complexity filter */}
      <div className="space-y-2">
        <MonoLabel tone="muted">Complexity</MonoLabel>
        <div className="space-y-0.5">
          {complexities.map((c) => {
            const isActive = c === complexity;
            const accent = c !== "all" ? complexityAccent[c] : undefined;
            return (
              <button
                key={c}
                onClick={() => onComplexityChange(c)}
                className={`w-full flex items-center gap-2 text-left px-2 py-1.5 font-mono text-[10px] uppercase tracking-wide rounded-[3px] transition-colors ${
                  isActive
                    ? "bg-white/[0.08] text-white/90 border border-white/[0.15]"
                    : "text-white/40 hover:text-white/70 hover:bg-white/[0.04] border border-transparent"
                }`}
              >
                {accent && (
                  <span
                    className="w-0.5 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: accent }}
                    aria-hidden
                  />
                )}
                <span>{formatLabel(c)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {hasActiveFilters && (
        <>
          <GlassDivider className="my-4" />
          <button
            onClick={onReset}
            className="w-full h-8 font-mono text-[10px] uppercase tracking-wide bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.15] rounded-[3px] text-white/60 hover:text-white/90 transition-all"
          >
            Reset Filters
          </button>
        </>
      )}
    </GlassCard>
  );
}
