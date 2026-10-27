"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Hash } from "lucide-react";
import type { RuntimeAuth } from "@/features/home/preview-types";
import { OpenScaleButton } from "@/shared/ui/open-scale-button";
import { SearchPill } from "@/shared/ui/search-pill";
import { SelectMenu } from "@/shared/ui/select-menu";
import { ALL_CHANNELS } from "../lib/identity-preview";
import { SORT_OPTIONS, type IdentityArrangement } from "../lib/identity-runs";

const AUTH_WORD: Record<RuntimeAuth["state"], string> = {
  expired: "needs re-auth",
  signed_out: "is not signed in",
};

/**
 * The page head, from the account's preview (INVARIANTS §4A): the channel scope with what it is
 * showing, and each runtime that cannot launch with its Fix. Absent parts draw nothing.
 */
export function IdentityPageHead({
  scope,
  reauth,
  runtimeLabel,
  onFix,
}: {
  scope: {
    value: string;
    channels: ReadonlyArray<string>;
    onChange: (next: string) => void;
    sharedCount: number;
    personalCount: number;
  } | null;
  reauth: ReadonlyArray<RuntimeAuth>;
  runtimeLabel: (runtime: string) => string;
  /** Opens the runtime's sign-in; absent = no Fix button. */
  onFix?: (runtime: string) => void;
}) {
  if (!scope && reauth.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      {scope && (
        <>
          <SelectMenu
            variant="bare"
            value={scope.value}
            options={[
              {
                value: ALL_CHANNELS,
                label: "All channels",
                description: "Every identity shared with you, wherever it lives",
              },
              ...scope.channels.map((channel) => ({
                value: channel,
                label: channel,
                description: `Only identities shared in ${channel}`,
              })),
            ]}
            onChange={scope.onChange}
            ariaLabel="Which channels to show"
            icon={<Hash size={12} strokeWidth={2.5} className="text-text-muted" aria-hidden="true" />}
            className="text-small"
          />
          <p className="min-w-0 truncate text-caption text-text-muted">
            {scope.sharedCount} shared
            {scope.value === ALL_CHANNELS ? " across your channels" : ` in ${scope.value}`} ·{" "}
            {scope.personalCount} personal
          </p>
        </>
      )}
      {reauth.map((row) => (
        <p key={row.runtime} className="flex min-w-0 flex-none items-center gap-1.5 text-caption">
          <AlertTriangle size={12} strokeWidth={2} className="flex-none text-warning" aria-hidden="true" />
          <span className="min-w-0 truncate text-text-secondary">
            {runtimeLabel(row.runtime)} {AUTH_WORD[row.state]}
          </span>
          {onFix && <OpenScaleButton onClick={() => onFix(row.runtime)}>Fix</OpenScaleButton>}
        </p>
      ))}
    </div>
  );
}

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
