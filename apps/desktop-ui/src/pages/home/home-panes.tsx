import { Link2 } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import type { BootPayload } from "#/pages/boot/use-boot-state";
import { RelationshipRecord } from "./relationship-record";
import { PendingLinkCard } from "./link-out-panel";
import { HomeKnowledgePanels } from "./knowledge-panels";
import { HomeIdentityPanels } from "./identity-panels";
import { HomeOntologyPanels } from "./ontology-panels";
import { HomeOverviewPanels } from "./overview-panels";
import type { ActivityJump } from "./use-activity-jump";
import type { HomeRow } from "./home-rows";
import {
  IDENTITIES_PANE,
  EMPTY_PANE,
  KNOWLEDGE_PANE,
  ONTOLOGY_PANE,
  OVERVIEW_PANE,
  type HomeTab,
} from "./home-tabs";

/** /home's record pane: which token the crossfade is on, and what that token renders. */

/**
 * A face that renders a CHANNEL's contents is keyed by the row, so switching channels fires the
 * crossfade instead of swapping content under an unchanged token. Cross-channel faces (Overview,
 * Ontology) carry no row: re-keying them would remount on every list click.
 */
export function paneToken(tab: HomeTab, selectedId: string | null): string {
  if (tab === "knowledge") return `${KNOWLEDGE_PANE}${selectedId ?? EMPTY_PANE}`;
  if (tab === "identities") return `${IDENTITIES_PANE}${selectedId ?? EMPTY_PANE}`;
  if (tab === "ontology") return ONTOLOGY_PANE;
  if (tab === "overview") return OVERVIEW_PANE;
  return selectedId ?? EMPTY_PANE;
}

export interface HomePaneProps {
  /** The token currently ON SCREEN — which lags the selection by one fade. */
  shown: string;
  /** Every row the operator has. */
  rows: HomeRow[];
  identity: BootPayload;
  jump: ActivityJump;
  /** The selected channel was deleted. */
  onChannelDeleted: () => void;
}

/**
 * What the pane shows for one token. Pure in `shown`: the crossfade renders the PREVIOUS token for
 * a beat, so reading the page's selection here would swap content before the fade. Prefixed faces
 * go first; the prefixes are disjoint and none can be a row id (`home-tabs.ts`).
 */
export function HomePane({
  shown,
  rows,
  identity,
  jump,
  onChannelDeleted,
}: HomePaneProps) {
  /** The row a pane token names, read out of the token, never the page's selection. */
  const rowFor = (id: string) =>
    rows.find((candidate) => candidate.id === id) ?? null;

  if (shown === OVERVIEW_PANE) {
    // The caller's `kind='home'` container, so the credit bar reads their PERSONAL wallet
    // (`credits-service.ts › resolveBillingTarget`). Null until onboarded.
    return (
      <HomeOverviewPanels homeWorkspaceId={identity.workspace?.id ?? null} />
    );
  }
  if (shown === ONTOLOGY_PANE) {
    // An ontology is a personal item lent into channels, so this face takes the home space.
    return (
      <HomeOntologyPanels
        homeWorkspaceId={identity.workspace?.id ?? null}
        homeWorkspaceSegment={identity.segment}
      />
    );
  }
  if (shown.startsWith(IDENTITIES_PANE)) {
    const shownRow = rowFor(shown.slice(IDENTITIES_PANE.length));
    return (
      <HomeIdentityPanels
        // Keyed by the token (F-338): without it one instance survives a channel switch and its
        // held editor writes into the NEW channel's container.
        key={shown}
        channel={shownRow?.kind === "channel" ? shownRow.channel : null}
        // `POST /api/boot`'s home workspace; null until onboarded.
        homeWorkspaceId={identity.workspace?.id ?? null}
        currentUserId={identity.userId}
      />
    );
  }
  if (shown.startsWith(KNOWLEDGE_PANE)) {
    const shownRow = rowFor(shown.slice(KNOWLEDGE_PANE.length));
    return (
      <HomeKnowledgePanels
        // Keyed by the row: the pane's own state (an open base) must not survive a channel switch.
        key={shownRow?.id ?? EMPTY_PANE}
        channel={shownRow?.kind === "channel" ? shownRow.channel : null}
        // `POST /api/boot`'s home workspace; null until onboarded.
        homeWorkspaceId={identity.workspace?.id ?? null}
        homeWorkspaceSegment={identity.segment}
        homeRole={identity.role}
        currentUserId={identity.userId}
      />
    );
  }
  const row = rowFor(shown);
  if (row === null) {
    // No row: either there are no channels, or the deleted one's token is still fading out.
    return rows.length === 0 ? (
      <EmptyState
        icon={Link2}
        title="No channels yet"
        description="Create one and launch an agent into it."
      />
    ) : null;
  }
  if (row.kind === "link") return <PendingLinkCard key={row.id} link={row.link} />;
  return (
    <RelationshipRecord
      key={row.id}
      homeChannel={row.channel}
      currentUserId={identity.userId}
      // Keyed by the row, so a thread picked in one channel is never raised in another.
      initialThreadId={jump.threadFor(row.id)}
      // The message a search row named (F-714).
      initialSeq={jump.seqFor(row.id)}
      onDeleted={onChannelDeleted}
    />
  );
}
