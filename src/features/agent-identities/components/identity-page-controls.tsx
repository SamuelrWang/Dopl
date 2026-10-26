"use client";

import { useRef } from "react";
import { AlertTriangle, Search, X } from "lucide-react";
import { SelectMenu } from "@/shared/ui/select-menu";
import {
  SORT_OPTIONS,
  type IdentityArrangement,
  type RuntimeReadiness,
} from "../lib/identity-runs";

/**
 * The page's own surfaces above the grid: the head says what the page holds and whether its
 * runtimes can launch; the controls directly above the grid only rearrange it. Neither row is a
 * container, so each ends where its content ends.
 */

export function IdentityPageHead({
  sharedCount,
  personalCount,
  readiness,
}: {
  /** `null` = no channel, so no shared count to state. */
  sharedCount: number | null;
  personalCount: number;
  /** `null` = the desktop has not said. */
  readiness: ReadonlyArray<RuntimeReadiness> | null;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      <p className="min-w-0 truncate text-caption text-text-muted">
        {sharedCount !== null && `${sharedCount} shared in this channel · `}
        {personalCount} personal
      </p>
      {readiness && <RuntimeReadinessLine readiness={readiness} />}
    </div>
  );
}

/** One quiet line when every runtime can launch; otherwise it names only the ones that cannot. */
function RuntimeReadinessLine({ readiness }: { readiness: ReadonlyArray<RuntimeReadiness> }) {
  const blocked = readiness.filter((r) => !r.ready);
  if (blocked.length === 0) {
    return (
      <p className="flex flex-none items-center gap-1.5 text-caption text-text-muted">
        <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
        All runtimes ready
      </p>
    );
  }
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-caption">
      <AlertTriangle size={12} strokeWidth={2} className="flex-none text-warning" aria-hidden="true" />
      <span className="min-w-0 truncate text-text-secondary">
        {blocked.map((r) => `${r.label} is not signed in`).join(" · ")}
      </span>
    </p>
  );
}

export function IdentityControls({
  arrangement,
  onArrangement,
  runtimes,
  showing,
  total,
}: {
  arrangement: IdentityArrangement;
  onArrangement: (next: IdentityArrangement) => void;
  /** The runtimes worth filtering by. */
  runtimes: ReadonlyArray<{ id: string; label: string }>;
  showing: number;
  total: number;
}) {
  const set = (patch: Partial<IdentityArrangement>) => onArrangement({ ...arrangement, ...patch });
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-4">
      <IdentitySearchField value={arrangement.query} onChange={(query) => set({ query })} />
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
    </div>
  );
}

/**
 * The app's own search pill (`.search-expand`, the recipe /home's search wears), held open: a
 * filter has no collapsed state, and it carries a clear because a filter you cannot drop traps
 * the grid. Not the kit's `SearchField`, which is concave and banned on /home.
 */
function IdentitySearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="search-expand" data-open="true">
      <div className="auth-btn-3d-light search-expand-shell">
        <span className="search-expand-toggle" aria-hidden="true">
          <Search size={15} strokeWidth={2} />
        </span>
        <input
          ref={inputRef}
          className="search-expand-input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search identities"
          aria-label="Search identities"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            onChange("");
            inputRef.current?.blur();
          }}
        />
        {value !== "" && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            className="mr-3 flex size-5 flex-none items-center justify-center rounded-full text-text-muted transition-colors hover:text-text-primary"
          >
            <X size={12} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
}
