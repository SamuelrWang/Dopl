"use client";

import { useState } from "react";
import type { Role } from "@/features/workspaces/types";
import type { KbShelf, KnowledgeBase, KnowledgeBaseStats } from "../../types";
import { CreateBaseDialog } from "../create-base-dialog";
import { KnowledgeV2 } from "./knowledge-v2";
import type { KnowledgeRouting, KnowledgeUrlSync } from "./routing";
import type { BaseTree, KbTeamRef, Selection } from "./types";

export interface KnowledgeV2PreviewCoreProps {
  workspaceSegment: string;
  workspaceId: string;
  bases: KnowledgeBase[];
  /** Display names for foreign base owners, keyed by user id. */
  ownerNames?: Record<string, string>;
  /** Keyed by base id; home card meta line + storage bar. Same list response
   *  as `ownerNames`. */
  baseStats?: Record<string, KnowledgeBaseStats>;
  /** Per-base storage cap in bytes, same response. */
  kbStorageLimit?: number | null;
  currentUserId: string;
  role: Role;
  /** Admin-only: kbId → teams granted, for the base overview. */
  kbTeams?: Record<string, KbTeamRef[]>;
  /** Pre-resolved deep-link target (base/entry), if the route carried one. */
  initialSelection?: Selection | null;
  /** Pre-resolved trees to seed (the deep-linked base), keyed by baseId. */
  initialTrees?: Record<string, BaseTree>;
  /** Bundled hero image for the home banner — injected by the host app. */
  heroImageSrc?: string;
  /**
   * WHICH SHELF this view is (`../../types.ts › KbShelf`) — threaded, not
   * assumed, because it has to reach TWO places that would otherwise disagree:
   * the controller's live base-list query (and the star write that patches it)
   * and the create dialog's cache seed. A host that narrows its read and
   * forgets either one gets a §8 silent no-op: a star that round-trips without
   * moving, or a new base that does not appear until a cold refetch.
   * ⚠ Undefined = unfiltered, the pre-2026-08-26 behaviour.
   */
  shelf?: KbShelf;
  /**
   * Passed straight to the create dialog — see `../create-base-dialog.tsx ›
   * Props.audienceFixed`. The /home mounts set it (the button that opened the
   * pane already named the audience); the workspace Knowledge page does not.
   */
  audienceFixed?: boolean;
  /** Router-shaped dependencies, injected (./routing.ts). */
  routing: KnowledgeRouting;
  urlSync?: KnowledgeUrlSync;
  /** This mount is already inside a panel — paint none. Threaded straight to
   *  `./knowledge-v2.tsx › Props.embedded`, which carries the argument. */
  embedded?: boolean;
}

/**
 * Knowledge V2 entry point: the two-mode view plus the create-base dialog the
 * home grid's trailing cell opens. App shell is the host layout's.
 *
 * ⚠ FILE NAME IS A FOSSIL. This is the ONE knowledge entry point; its only
 * caller is apps/desktop-ui/src/pages/knowledge/index.tsx. Next-free by
 * construction — `routing`/`urlSync` are injected (./routing.ts).
 */
export function KnowledgeV2PreviewCore({
  workspaceSegment,
  workspaceId,
  bases,
  ownerNames,
  baseStats,
  kbStorageLimit,
  currentUserId,
  role,
  kbTeams,
  initialSelection,
  initialTrees,
  heroImageSrc,
  shelf,
  audienceFixed,
  routing,
  urlSync,
  embedded,
}: KnowledgeV2PreviewCoreProps) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <KnowledgeV2
        workspaceId={workspaceId}
        workspaceSegment={workspaceSegment}
        bases={bases}
        ownerNames={ownerNames}
        baseStats={baseStats}
        kbStorageLimit={kbStorageLimit}
        currentUserId={currentUserId}
        role={role}
        kbTeams={kbTeams}
        initialSelection={initialSelection}
        initialTrees={initialTrees}
        onCreate={() => setCreateOpen(true)}
        heroImageSrc={heroImageSrc}
        shelf={shelf}
        routing={routing}
        urlSync={urlSync}
        embedded={embedded}
      />

      <CreateBaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSegment}
        currentUserId={currentUserId}
        role={role}
        // ⚠ THE SAME SHELF THE VIEW READS. The dialog seeds the cache entry
        // this prop names; handing it `undefined` while the controller reads
        // `:shelf:workspace` seeds a key nobody has mounted.
        shelf={shelf}
        audienceFixed={audienceFixed}
        routing={routing}
      />
    </>
  );
}
