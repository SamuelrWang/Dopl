/**
 * THE TWO CARD SECTIONS of /home → Identities, lifted out of `identity-panels.tsx` when the page
 * surfaces (item 3c) pushed that file past the 500-line lint ceiling. Nothing about either section
 * changed in the move.
 *
 * ⚠ Both are `identity-section.tsx`'s flat `IdentityPanel` + `IdentityGrid`, never `SectionBox`
 * (/home has no concave surface; swept by `identity-editor-surface.test.tsx`).
 */
import type { ReactNode } from "react";
import { OpenScaleButton } from "@/shared/ui/open-scale-button";
import {
  IdentityGrid,
  IdentityPanel,
} from "@/features/identities-staging/agent-identities/components/identity-section";
import type { AgentIdentity } from "@/features/agent-identities/client/types";
import type { IdentitySectionDef } from "@/features/agent-identities/lib/visibility";
import { STAGING_CATALOGS, identityCardFace, identityCardStats } from "../data";

/** No home workspace yet — a different sentence from "none here". */
export const SCOPE_UNAVAILABLE = "Finish setting up your home space to keep identities there.";

// ── The two sections: `identity-section.tsx`'s flat `IdentityPanel` + `IdentityGrid`, never
// `SectionBox` (/home has no concave surface; swept by `identity-editor-surface.test.tsx`).

/** The channel's shared identities — who else in this relationship can wear them. */
export function SharedIdentitySection({
  label,
  emptyLine,
  identities,
  markerFor,
  scopeFor,
  caption,
  onOpen,
  action,
}: {
  /** ITEM 3C: the heading is the PAGE's, not the container's — it names the current scope. */
  label: string;
  emptyLine?: string;
  identities: ReadonlyArray<AgentIdentity>;
  markerFor: (identity: AgentIdentity) => string | null;
  /** Where each row is shared (`page/identity-page-data.ts › reachLabel`). */
  scopeFor: (identity: AgentIdentity) => string | null;
  /** One quiet line under the heading, for the rule that creating needs one channel. */
  caption?: string;
  /** Header-right control (the create button). */
  action?: ReactNode;
  /** Opens the editor against the channel's container. Openable on a peer's row too: the write
   *  floor is the server's (member+), and the marker says whose instructions these are. */
  onOpen: (identity: AgentIdentity) => void;
}) {
  return (
    <IdentityPanel
      id="home-agents-shared"
      label={label}
      action={action}
      caption={caption}
    >
      <IdentityGrid
        identities={identities}
        emptyLine={emptyLine}
        markerFor={markerFor}
        onOpen={onOpen}
        // STAGING: the face is `data.ts`'s; in the product it is the roster + runtime registry.
        faceFor={identityCardFace}
        // Mock live state on the staged card (ask §2b checklist 2): running count, last used,
        // and who else in the channel can wear it. `data.ts › identityCardStats`.
        statsFor={identityCardStats}
        // The chip reads "Sonnet 5", not "Claude Sonnet 5": `agentModelShortLabel` only has a
        // short label when it is handed the catalogs, and /home never handed them over (the card
        // has taken the prop all along). Port note in PORTING.md.
        catalogs={STAGING_CATALOGS}
        // Where this row is shared, per row (item 3c: the page spans every channel).
        scopeFor={scopeFor}
      />
    </IdentityPanel>
  );
}

/**
 * The caller's own private identities. Five body states and only the grid may state an
 * emptiness: `unavailable` (no home workspace), `failure` (answered with an error — outranks
 * `pending`, since a failed read never resolves, F-339), `pending`, the empty line, the grid.
 */
export function PrivateIdentitySection({
  section,
  identities,
  action,
  unavailable,
  failure,
  pending,
  onOpen,
  cardActionFor,
}: {
  section: IdentitySectionDef;
  identities: ReadonlyArray<AgentIdentity>;
  /** The create button. */
  action: ReactNode;
  /** There is nowhere to look — a sentence, not an empty list. */
  unavailable: string | null;
  /** The server's own wording plus a retry; `null` when the read did not fail. */
  failure: { message: string; onRetry: () => void } | null;
  pending: boolean;
  /** Opens the editor where the row lives (the home workspace). */
  onOpen: (identity: AgentIdentity) => void;
  /** The card's one action slot: the knowledge box and Launch travel together
   *  (`identity-section.tsx › IdentityCard` carries exactly one). */
  cardActionFor?: (identity: AgentIdentity) => ReactNode;
}) {
  return (
    <IdentityPanel
      id="home-agents-private"
      label={section.label}
      action={action}
    >
      {unavailable !== null ? (
        <p className="px-1 pb-1 text-caption text-text-muted">{unavailable}</p>
      ) : failure !== null ? (
        // Not `PageError`: that is a whole-pane state, and the other section loaded fine.
        <div className="flex flex-wrap items-center gap-2 px-1 pb-1">
          <p className="text-caption text-text-muted">{failure.message}</p>
          <OpenScaleButton onClick={failure.onRetry}>
            Try again
          </OpenScaleButton>
        </div>
      ) : pending ? (
        <div className="h-10" />
      ) : (
        <IdentityGrid
          identities={identities}
          emptyLine={section.emptyLine}
          onOpen={onOpen}
          actionFor={cardActionFor}
          // The owner is always the caller here (`isMine`), so this is their own photo.
          // No `scopeLabel`: "Personal" is the section's word and a private card needs no badge.
          faceFor={identityCardFace}
          statsFor={identityCardStats}
          catalogs={STAGING_CATALOGS}
        />
      )}
    </IdentityPanel>
  );
}

