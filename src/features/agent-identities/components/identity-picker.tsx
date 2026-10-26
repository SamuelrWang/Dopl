"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { MenuDivider, Popover } from "@/shared/ui/popover-menu";
import { agentModelShortLabel } from "@/features/channels/lib/agent-models";
import type { ModelCatalogs } from "@/features/channels/lib/model-catalog";
import { agentIdentityErrorMessage } from "../client/api";
import type { AgentIdentity } from "../client/types";
import { useAgentIdentities } from "../hooks/use-agent-identities";
import { SECTIONS, groupByVisibility } from "../lib/visibility";

/**
 * Which identity the next agent wears — a popover on the Agents tab's New Agent split button. It
 * chooses and hands the row up; the New agent popup launches (one launch lane, INVARIANTS §5A).
 * The authorship marker is a security signal (another member's instructions run as this operator),
 * so it is in the row's accessible name too.
 */

/** Below this the search field is chrome for nothing. */
export const SEARCH_THRESHOLD = 8;

/** What the surface does with a pick: open the New agent popup on it, and nothing else. */
export interface IdentityPickerHandlers {
  /** `null` opens the popup on a blank agent. */
  onPick: (identity: AgentIdentity | null) => void;
}

/**
 * `by <member>` for an identity this operator did not write, else `null`. An unresolvable author is
 * still foreign ("by another member") — unknown must never read as mine (INVARIANTS §11).
 */
export function authorMarker(
  identity: AgentIdentity,
  currentUserId: string | null,
  memberNames?: ReadonlyMap<string, string>
): string | null {
  if (currentUserId && identity.createdBy === currentUserId) return null;
  const name = identity.createdBy ? memberNames?.get(identity.createdBy) : null;
  return name ? `by ${name}` : "by another member";
}

/**
 * The picker's anchor state (coordinate mode: the hosts are clipping panes). It takes the clicked
 * element instead of returning a ref, which `react-hooks/refs` would flag on every render read.
 */
export function useIdentityPicker() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  return {
    at,
    open: at !== null,
    close: () => setAt(null),
    /** Toggle, anchored under the element that was clicked. */
    toggleFrom: (el: HTMLElement | null) => {
      if (at) {
        setAt(null);
        return;
      }
      const rect = el?.getBoundingClientRect();
      setAt(rect ? { x: rect.left, y: rect.bottom + 6 } : { x: 0, y: 0 });
    },
  };
}

export function IdentityLaunchPicker({
  open,
  at,
  onClose,
  workspaceId,
  currentUserId = null,
  memberNames,
  busy = false,
  catalogs,
  onPick,
}: {
  open: boolean;
  at: { x: number; y: number } | null;
  onClose: () => void;
  workspaceId: string;
  currentUserId?: string | null;
  /** `userId → display name`, for the authorship marker. */
  memberNames?: ReadonlyMap<string, string>;
  /** A launch already in flight — the same double-submit guard the surfaces use. */
  busy?: boolean;
  /** The live model catalogs the host holds, for the rows' model chips. */
  catalogs?: ModelCatalogs | null;
} & IdentityPickerHandlers) {
  /** Choosing closes the popover and hands the row up; it starts nothing. */
  function choose(identity: AgentIdentity | null) {
    onClose();
    onPick(identity);
  }

  return (
    <Popover
      open={open}
      at={at ?? undefined}
      onClose={onClose}
      className="max-h-[min(60vh,420px)] w-[288px] overflow-y-auto"
    >
      <PickerBody
        workspaceId={workspaceId}
        currentUserId={currentUserId}
        memberNames={memberNames}
        busy={busy}
        catalogs={catalogs}
        onBlank={() => choose(null)}
        onPick={choose}
      />
    </Popover>
  );
}

/** The popover body — the list read mounts here, so a closed picker costs no request. */
function PickerBody({
  workspaceId,
  currentUserId,
  memberNames,
  busy,
  catalogs,
  onBlank,
  onPick,
}: {
  workspaceId: string;
  currentUserId: string | null;
  memberNames?: ReadonlyMap<string, string>;
  busy: boolean;
  catalogs?: ModelCatalogs | null;
  onBlank: () => void;
  onPick: (identity: AgentIdentity) => void;
}) {
  const list = useAgentIdentities(workspaceId);
  const [query, setQuery] = useState("");

  // The threshold reads the whole list, so the field never vanishes mid-search.
  const searchable = list.identities.length > SEARCH_THRESHOLD;
  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      needle
        ? list.identities.filter((t) => t.name.toLowerCase().includes(needle))
        : list.identities,
    [list.identities, needle]
  );
  const grouped = useMemo(() => groupByVisibility(visible), [visible]);
  // Group headers only when more than one group is filled (minimal copy, INVARIANTS §5).
  const filled = SECTIONS.filter((s) => grouped[s.visibility].length > 0);

  return (
    <div className="flex flex-col">
      <button
        type="button"
        role="menuitem"
        autoFocus
        onClick={onBlank}
        disabled={busy}
        className="menu-row flex w-full cursor-pointer flex-col items-start gap-0.5 px-2.5 py-1.5 text-left disabled:opacity-60"
      >
        <span className="text-small text-text-primary">Blank agent</span>
        <span className="text-caption text-text-muted">No identity</span>
      </button>

      {(list.loading || list.error != null || visible.length > 0 || searchable) && (
        <MenuDivider />
      )}

      {searchable && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5">
          <Search size={12} aria-hidden className="shrink-0 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search identities"
            placeholder="Search identities"
            className="min-w-0 flex-1 bg-transparent text-small text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>
      )}

      {list.loading ? (
        <p className="px-2.5 py-2 text-caption text-text-muted">Loading identities…</p>
      ) : list.error != null ? (
        // A failed read is not an empty list (INVARIANTS §11).
        <p role="alert" className="px-2.5 py-2 text-caption text-danger">
          {agentIdentityErrorMessage(list.error, "Couldn't load identities")}
        </p>
      ) : visible.length === 0 ? (
        <p className="px-2.5 py-2 text-caption text-text-muted">
          {needle ? "No identity matches." : "No identities yet."}
        </p>
      ) : (
        filled.map((section) => (
          <div key={section.visibility} role="none">
            {filled.length > 1 && (
              <p className="px-2.5 pb-0.5 pt-2 text-label font-semibold uppercase tracking-wide text-text-muted">
                {section.label}
              </p>
            )}
            {grouped[section.visibility].map((identity) => (
              <IdentityRow
                key={identity.id}
                identity={identity}
                marker={authorMarker(identity, currentUserId, memberNames)}
                busy={busy}
                catalogs={catalogs}
                onPick={onPick}
              />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

/** One identity, one act: the row opens the New agent popup on it. */
function IdentityRow({
  identity,
  marker,
  busy,
  catalogs,
  onPick,
}: {
  identity: AgentIdentity;
  marker: string | null;
  busy: boolean;
  catalogs?: ModelCatalogs | null;
  onPick: (identity: AgentIdentity) => void;
}) {
  const model = agentModelShortLabel(identity.model, catalogs);
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => onPick(identity)}
      disabled={busy}
      // The marker is in the accessible name: the security signal reaches screen readers too.
      aria-label={["Launch", identity.name, marker ? `(${marker})` : null]
        .filter(Boolean)
        .join(" ")}
      className="menu-row flex w-full min-w-0 cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left disabled:opacity-60"
    >
      <span className="min-w-0 flex-1 truncate text-small text-text-primary">
        {identity.name}
      </span>
      {marker && (
        <span className="shrink-0 text-caption text-text-muted">{marker}</span>
      )}
      {model && (
        <span className="shrink-0 rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium text-text-secondary">
          {model}
        </span>
      )}
    </button>
  );
}
