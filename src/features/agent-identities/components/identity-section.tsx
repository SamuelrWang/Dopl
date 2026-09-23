"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { agentModelShortLabel } from "@/features/channels/lib/agent-models";
import type { ModelCatalogs } from "@/features/channels/lib/model-catalog";
import { pendingRow } from "@/shared/ui/pending";
import { SectionPanel } from "@/shared/ui/section-panel";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import type { AgentIdentity } from "../client/types";
import type { IdentitySectionDef } from "../lib/visibility";

/**
 * One scope panel and its cards: a flat `SectionPanel` holding `.bento` cards — nothing pressed in
 * (Samuel's ruling). Shell, grid and section are separately callable so the /home face composes
 * the same parts. An empty section keeps its header and says one line.
 */

/** Four cards per row, fixed (Samuel's ruling, not auto-fill); the skeletons import it. */
export const IDENTITY_GRID = "grid grid-cols-4 gap-2.5";

export function IdentityPanel({
  id,
  label,
  action,
  children,
}: {
  /** Id the heading carries, so the section is a named region. */
  id: string;
  label: string;
  /** Header-right control (the /home face's scope pill). */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SectionPanel
      id={id}
      label={label}
      action={action}
    >
      {children}
    </SectionPanel>
  );
}

/** The card grid, or the one quiet line that stands in for it. */
export function IdentityGrid({
  identities,
  emptyLine,
  onOpen,
  pendingIds,
  markerFor,
  actionFor,
  catalogs,
}: {
  identities: ReadonlyArray<AgentIdentity>;
  /** Rendered only against a resolved read; absent = an empty grid renders nothing. */
  emptyLine?: string;
  /** Absent = the cards are not openable on this surface. */
  onOpen?: (identity: AgentIdentity) => void;
  /** Rows with a write in flight — dimmed and inert via the kit's PENDING_ROW. */
  pendingIds?: ReadonlySet<string>;
  /** `by <member>` for a row this operator did not write, else `null`. */
  markerFor?: (identity: AgentIdentity) => string | null;
  /** A second control for a row, under the body ({@link IdentityCard}). */
  actionFor?: (identity: AgentIdentity) => ReactNode;
  /** The live model catalogs the host holds, so a model chip reads as its label, not a raw id. */
  catalogs?: ModelCatalogs | null;
}) {
  if (identities.length === 0) {
    return emptyLine ? (
      <p className="px-1 pb-1 text-caption text-text-muted">{emptyLine}</p>
    ) : null;
  }
  return (
    <div className={IDENTITY_GRID}>
      {identities.map((identity) => (
        <IdentityCard
          key={identity.id}
          identity={identity}
          onOpen={onOpen}
          pending={pendingIds?.has(identity.id) ?? false}
          marker={markerFor?.(identity) ?? null}
          action={actionFor?.(identity) ?? null}
          catalogs={catalogs}
        />
      ))}
    </div>
  );
}

export function IdentitySection({
  section,
  identities,
  onOpen,
  pendingIds,
  catalogs,
}: {
  section: IdentitySectionDef;
  identities: ReadonlyArray<AgentIdentity>;
  onOpen: (identity: AgentIdentity) => void;
  pendingIds?: ReadonlySet<string>;
  catalogs?: ModelCatalogs | null;
}) {
  return (
    <IdentityPanel
      id={`agent-identities-${section.visibility}`}
      label={section.label}
    >
      <IdentityGrid
        identities={identities}
        emptyLine={section.emptyLine}
        onOpen={onOpen}
        pendingIds={pendingIds}
        catalogs={catalogs}
      />
    </IdentityPanel>
  );
}

/**
 * One identity as a card: marker, name, a model chip only when one is set, a muted description.
 * The authorship marker is a security signal (`identity-picker.tsx › authorMarker`) and renders first.
 * With an `action`, the face becomes a `div` and the body the button (no nested buttons).
 */
function IdentityCard({
  identity,
  onOpen,
  pending,
  marker,
  action,
  catalogs,
}: {
  identity: AgentIdentity;
  onOpen?: (identity: AgentIdentity) => void;
  pending: boolean;
  marker: string | null;
  action: ReactNode;
  catalogs?: ModelCatalogs | null;
}) {
  const model = agentModelShortLabel(identity.model, catalogs);
  const description = identity.description?.trim();
  const body = (
    <>
      {marker && (
        <span className="w-fit shrink-0 rounded-full border border-border-strong bg-bg-elevated px-2 py-px text-micro font-medium text-text-muted">
          {marker}
        </span>
      )}
      <span className="flex w-full items-start justify-between gap-2">
        <span className={cn("min-w-0 truncate", IDENTITY_NAME_TEXT)}>
          {identity.name}
        </span>
        {model && (
          <span className="shrink-0 rounded-full bg-bg-inset px-2 py-0.5 text-micro font-medium text-text-secondary">
            {model}
          </span>
        )}
      </span>
      {description && (
        <span className="line-clamp-2 text-caption leading-relaxed text-text-secondary">
          {description}
        </span>
      )}
    </>
  );
  const face = "bento flex min-h-[92px] flex-col gap-1.5 p-3 text-left";
  // The kit's `.card-lift`, shared with the Knowledge card.
  const raise = "card-lift";

  if (action) {
    return (
      <div {...pendingRow(pending, cn(face, onOpen && raise))}>
        {onOpen ? (
          <button
            type="button"
            onClick={() => onOpen(identity)}
            className="flex flex-1 cursor-pointer flex-col items-start gap-1.5 text-left"
          >
            {body}
          </button>
        ) : (
          body
        )}
        <div className="mt-auto w-full pt-1.5">{action}</div>
      </div>
    );
  }

  if (!onOpen) return <div {...pendingRow(pending, face)}>{body}</div>;
  return (
    <button
      type="button"
      onClick={() => onOpen(identity)}
      {...pendingRow(pending, cn(face, "cursor-pointer", raise))}
    >
      {body}
    </button>
  );
}
