"use client";

import type { ReactNode } from "react";
import { SearchPill } from "@/shared/ui/search-pill";
import { SelectMenu } from "@/shared/ui/select-menu";
import { SORT_OPTIONS, type IdentityArrangement } from "../lib/identity-runs";

/**
 * The page's one controls row, above the grid: the search pill (the header search's face), the
 * runtime filter and the sort, then the page's single create button at the right end.
 */
export function IdentityControls({
  arrangement,
  onArrangement,
  runtimes,
  showing,
  total,
  action,
}: {
  arrangement: IdentityArrangement;
  onArrangement: (next: IdentityArrangement) => void;
  /** The runtimes worth filtering by. */
  runtimes: ReadonlyArray<{ id: string; label: string }>;
  showing: number;
  total: number;
  /** The page's create button. */
  action: ReactNode;
}) {
  const set = (patch: Partial<IdentityArrangement>) => onArrangement({ ...arrangement, ...patch });
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-4">
      <SearchPill
        label="Search identities"
        value={arrangement.query}
        onChange={(query) => set({ query })}
      />
      {runtimes.length > 0 && (
        <SelectMenu
          variant="bare"
          value={arrangement.runtime}
          options={[
            { value: "all", label: "Any runtime" },
            ...runtimes.map((r) => ({
              value: r.id,
              label: r.label,
              description: `Only identities that run on ${r.label}`,
            })),
          ]}
          onChange={(runtime) => set({ runtime })}
          ariaLabel="Filter by runtime"
        />
      )}
      <SelectMenu
        variant="bare"
        value={arrangement.sort}
        options={SORT_OPTIONS}
        onChange={(sort) => set({ sort })}
        prefix="Sort"
        ariaLabel="Sort identities"
      />
      {showing !== total && (
        <p className="flex-none text-caption text-text-muted">
          {showing} of {total}
        </p>
      )}
      <div className="ml-auto flex-none">{action}</div>
    </div>
  );
}
