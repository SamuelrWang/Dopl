"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { UpgradeModal } from "@/features/billing/components/upgrade-modal";
import { useWorkspaceEntitlements } from "@/features/billing/components/use-workspace-entitlements";
import { cn } from "@/shared/lib/utils";
import { pendingRow } from "@/shared/ui/pending";
// The app's 36px black pill; `bits.tsx › TAB_ACTION` is its only declaration in
// `src` (/home's `panel-buttons.tsx › PAGE_ACTION_BTN` is the desktop-ui twin).
import { TAB_ACTION } from "@/features/channels/components/bits";
import { useOntology } from "../hooks/use-ontology";
import { useObjectDraft } from "../hooks/use-object-draft";
import { OntologyResourcesProvider } from "../hooks/use-workspace-resources";
import { BoardSettingsMenu, DescriptionField, NameField } from "./board-header-bits";
import { CapNotice } from "./cap-notice";
import { ClusterSwitcher, clusterSwitcherEntries } from "./cluster-switcher";
import { DeleteClusterDialog } from "./delete-cluster-dialog";
import { KanbanBoard } from "./kanban-board";
import { NewObjectDialog } from "./new-object-dialog";
import { ObjectPanel } from "./object-panel";
import { OntologyBoardSkeleton } from "./ontology-skeleton";

interface Props {
  workspaceId: string;
  workspaceSegment: string;
  /** Deep-linked cluster (`/[ws]/ontology/[clusterSlug]`); first cluster when omitted. */
  initialClusterSlug?: string;
  /**
   * Single-ontology mode: pin the board to one cluster (2026-09-09, the /home
   * Ontology face; `docs/specs/home-ontology.md` §5). A selection, never a
   * permission — the fence is the ontology service's (§4). Suppresses the gear's
   * Delete row and the URL write; the host owns both. A pin naming nothing
   * resolves to nothing, never to `clusters[0]` — falling back would open a
   * different ontology under the name the operator clicked. Pair with
   * `onSelectCluster` or a host picker moves nothing.
   */
  pinnedClusterId?: string;
  /** Host-owned selection, fired beside the view's own state so a pinned host can
   *  move its pin. Omit and the view keeps selecting for itself. */
  onSelectCluster?: (id: string) => void;
  /**
   * Overrides the "+ Ontology" row inside the name dropdown
   * (`cluster-switcher.tsx`). Omitted ⇒ the view's own optimistic
   * `createCluster`, which mints a provisional id a pin-holding host would be
   * left pointing at.
   */
  onCreateCluster?: () => void;
  /**
   * Host rows inside the header's gear menu. Rows, not a trigger (2026-09-10):
   * two menus in one header is the drift a single trigger removes. Takes the
   * menu's `close` so a row can dismiss it before opening a dialog.
   */
  settingsMenu?: (close: () => void) => ReactNode;
  /** Admin/owner — controls whether the upgrade prompt offers checkout. */
  canManageBilling?: boolean;
  /** Member+ — viewers read but can't create, so create affordances
   *  (New ontology / + Object / Add new) are hidden. */
  canEdit?: boolean;
  /**
   * How the address bar follows the active cluster's slug. Defaults to
   * `history.replaceState`; RSC pages pass nothing (a server component can't hand
   * a function to a client component). Desktop SPA injects its hash-router
   * equivalent — replacing the path in a `file://` document is a Chromium
   * security error.
   */
  replaceUrl?: (path: string) => void;
  /**
   * `true` when the host already IS a floated page panel (the /home pane): fill
   * the host instead of raising a second `.page-float` inside it. The workspace
   * page keeps its own float.
   */
  frameless?: boolean;
}

/** Module-level so the default is referentially stable across renders. */
const replaceHistoryUrl = (path: string): void =>
  window.history.replaceState(null, "", path);

/**
 * Ontology page root. One cluster per page; columns are container objects whose
 * children are cards. Edits persist through use-ontology. Active cluster is
 * URL-addressed by slug via replaceState, so tab flips don't remount the page.
 */
export function OntologyView({
  workspaceId,
  workspaceSegment,
  initialClusterSlug,
  pinnedClusterId,
  onSelectCluster,
  onCreateCluster,
  settingsMenu,
  canManageBilling = false,
  canEdit = true,
  replaceUrl = replaceHistoryUrl,
  frameless = false,
}: Props) {
  const Frame = frameless ? Fill : Float;
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // Declared above the store: the store's delete callback refreshes it.
  const ent = useWorkspaceEntitlements(workspaceId);
  const { isCapped, refresh } = ent;
  // Cap is a server-side count: only moves once the write has landed.
  const refreshCap = useCallback(() => {
    if (isCapped) void refresh();
  }, [isCapped, refresh]);
  const [clusterId, setClusterId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Create renders rows under PROVISIONAL ids, swapped when the POST answers;
  // selection is local state and must move with them, else board + panel blank
  // out exactly when the create succeeds.
  const handleIdsResolved = useCallback((map: Readonly<Record<string, string>>) => {
    setClusterId((id) => (id ? (map[id] ?? id) : id));
    setSelectedId((id) => (id ? (map[id] ?? id) : id));
  }, []);
  const {
    graph,
    status,
    dispatch,
    createCluster,
    createObject,
    beginColumnDraft,
    discardColumnDraft,
    commitColumnDraft,
    pendingIds,
  } = useOntology(
    workspaceId,
    {
      onOverCap: () => setUpgradeOpen(true),
      onDeleted: refreshCap,
      onCreated: refreshCap,
      onIdsResolved: handleIdsResolved,
    }
  );
  // "+ Object": the draft lane on the board, the popup over it (2026-09-11).
  const draft = useObjectDraft({
    beginColumnDraft,
    discardColumnDraft,
    commitColumnDraft,
  });
  const [confirmDeleteCluster, setConfirmDeleteCluster] = useState(false);
  // Lives here, not in either child: the row that starts renaming is in the gear
  // and the field that ends it stands where the switcher does, so neither
  // component can own the flag without reaching across the header.
  const [renaming, setRenaming] = useState(false);

  // The pin outranks all three fallbacks and has none of its own.
  const cluster = pinnedClusterId
    ? (graph.clusters.find((c) => c.id === pinnedClusterId) ?? null)
    : (graph.clusters.find((c) => c.id === clusterId) ??
      graph.clusters.find((c) => c.slug === initialClusterSlug) ??
      graph.clusters[0] ??
      null);
  const selected = selectedId ? (graph.objects[selectedId] ?? null) : null;
  const clusterPending = cluster ? pendingIds.has(cluster.id) : false;
  // One list for both picker faces, walked once per graph (`cluster-switcher.tsx`).
  const entries = useMemo(() => clusterSwitcherEntries(graph), [graph]);

  const selectCluster = (id: string) => {
    setClusterId(id);
    setSelectedId(null);
    setConfirmDeleteCluster(false);
    // A half-typed name belongs to the ontology that was open, not the next one.
    setRenaming(false);
    // Beside the local write, not instead of it: a pinned host resolves the
    // cluster from its own state, an unpinned one from `clusterId`.
    onSelectCluster?.(id);
  };

  // Effect, not inline in `selectCluster`: an optimistic cluster is selected
  // before it has a slug (server mints it, arrives via `CREATE_RESOLVE`). Keyed
  // on slug alone — stable across renames. Never in pinned mode: no URL there.
  const activeSlug =
    !pinnedClusterId && cluster && cluster.id === clusterId ? cluster.slug : null;
  useEffect(() => {
    if (activeSlug) replaceUrl(`/${workspaceSegment}/ontology/${activeSlug}`);
  }, [activeSlug, workspaceSegment, replaceUrl]);

  // Permanent cascading delete. Selection moves to the adjacent tab (next, else
  // previous), never index 0: the `?? clusters[0]` display fallback would land on
  // an unrelated board.
  const handleDeleteCluster = () => {
    if (!cluster) return;
    const at = graph.clusters.findIndex((c) => c.id === cluster.id);
    const neighbour = graph.clusters[at + 1] ?? graph.clusters[at - 1] ?? null;
    dispatch({ type: "CLUSTER_DELETE", id: cluster.id });
    setConfirmDeleteCluster(false);
    if (neighbour) {
      selectCluster(neighbour.id);
      return;
    }
    // Last cluster: drop the dead slug so a reload doesn't deep-link at it.
    setClusterId(null);
    setSelectedId(null);
    replaceUrl(`/${workspaceSegment}/ontology`);
  };

  // New cluster creates TWO objects (column + first card) → needs headroom of 2,
  // not just under-cap: a create at 999/1000 would trip the server cap
  // mid-sequence and leave an orphaned partial cluster.
  const handleCreateCluster = () => {
    if (
      ent.overCap ||
      (ent.isCapped &&
        ent.objectCap !== null &&
        ent.objectsUsed + 2 > ent.objectCap)
    ) {
      setUpgradeOpen(true);
      return;
    }
    // Synchronous: tab + column + first card land in the reducer before this
    // returns, so the board switches in the same frame as the click.
    selectCluster(createCluster().id);
  };

  // Cards inherit column's template fields, relationships, actions —
  // server-side, mirrored locally for the pending row.
  const handleCreateObject = (
    target: { clusterId: string } | { parentObjectId: string }
  ) => {
    if (ent.overCap) {
      setUpgradeOpen(true);
      return;
    }
    setSelectedId(createObject(target).id);
  };

  /**
   * "+ Object" creates the object TYPE, which is the lane (2026-09-11); cards are
   * the lane's own add button's job. One object, so the plain under-cap check.
   * The lane lands first and the popup opens over it; nothing is POSTed until
   * Create (`use-object-draft.ts`).
   */
  const handleNewObject = () => {
    if (!cluster) return;
    if (ent.overCap) {
      setUpgradeOpen(true);
      return;
    }
    draft.begin(cluster.id);
  };

  if (status === "loading") {
    return (
      <Frame>
        <OntologyBoardSkeleton />
      </Frame>
    );
  }
  if (status === "error") {
    return (
      <Frame>
        <p className="m-auto text-lead text-danger">
          Couldn&apos;t load the ontology. Refresh to retry.
        </p>
      </Frame>
    );
  }
  if (pinnedClusterId && !cluster) {
    // Not the empty state below: "there are none" and "the one you opened is
    // gone" are different answers, and the create button under the second would
    // make an unrelated ontology.
    return (
      <Frame>
        <p className="m-auto text-lead text-text-secondary">
          This ontology is no longer here.
        </p>
      </Frame>
    );
  }
  if (graph.clusters.length === 0) {
    return (
      <Frame>
        <div className="m-auto flex flex-col items-center gap-3">
          <p className="text-lead text-text-secondary">
            {canEdit
              ? "No ontology yet — create your first."
              : "No ontology yet — a workspace member can create the first one."}
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={handleCreateCluster}
              className="auth-btn-3d rounded-lg px-4 py-2 text-lead font-semibold text-white"
            >
              New ontology
            </button>
          )}
        </div>
      </Frame>
    );
  }
  if (!cluster) return <Frame />;

  return (
    <OntologyResourcesProvider workspaceId={workspaceId} graph={graph}>
      <Frame>
        {/* The header sits on the page's own white panel — no surface of its own
            here (2026-09-10: no double panel). The board below wears the dotted
            grid — `kanban-board.tsx`. */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-3 py-2">
          {/* The ontology's name IS the picker (2026-09-10); while renaming it is
              the kit's underline field in that slot, swapped rather than
              decorated, so the chevron goes with the trigger. */}
          {renaming ? (
            <NameField
              name={cluster.name}
              onCommit={(name) => {
                dispatch({ type: "CLUSTER_UPDATE", id: cluster.id, patch: { name } });
                setRenaming(false);
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <ClusterSwitcher
              entries={entries}
              activeId={cluster.id}
              canEdit={canEdit}
              onSelect={selectCluster}
              onCreate={onCreateCluster ?? handleCreateCluster}
            />
          )}
          {/* Inert until cluster is real: an edit on a provisional row would
              debounce a PATCH at an id the server has never seen. */}
          <div {...pendingRow(clusterPending, "flex min-w-0 flex-1 items-center")}>
            <DescriptionField
              value={cluster.purpose}
              onChange={(purpose) =>
                dispatch({
                  type: "CLUSTER_UPDATE",
                  id: cluster.id,
                  patch: { purpose },
                })
              }
            />
          </div>
          {(canEdit || settingsMenu) && (
            <BoardSettingsMenu
              clusterName={cluster.name}
              // Inert on a provisional cluster, like the Description field.
              onRename={
                canEdit && !clusterPending ? () => setRenaming(true) : undefined
              }
              hostRows={settingsMenu}
              // One Delete slot, and the gear is it (2026-09-10). Pinned mode is
              // how a host declares it brings its own Delete, so exactly one of
              // the two is ever rendered.
              onDelete={
                canEdit && !pinnedClusterId
                  ? () => setConfirmDeleteCluster(true)
                  : undefined
              }
            />
          )}
          {canEdit && (
            <button
              type="button"
              onClick={handleNewObject}
              {...pendingRow(clusterPending, cn(TAB_ACTION, "gap-1.5"))}
            >
              <Plus size={13} aria-hidden="true" /> Object
            </button>
          )}
        </div>

        {!ent.loading && ent.isCapped && ent.objectCap !== null && (
          <CapNotice
            used={ent.objectsUsed}
            cap={ent.objectCap}
            over={ent.overCap}
            onUpgrade={() => setUpgradeOpen(true)}
          />
        )}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <KanbanBoard
            cluster={cluster}
            graph={graph}
            dispatch={dispatch}
            selectedId={selectedId}
            pendingIds={pendingIds}
            canEdit={canEdit}
            onSelect={setSelectedId}
            onCreateObject={(columnId) => handleCreateObject({ parentObjectId: columnId })}
          />
          {selected && selectedId && (
            <ObjectPanel
              workspaceId={workspaceId}
              objectId={selectedId}
              graph={graph}
              dispatch={dispatch}
              pending={pendingIds.has(selectedId)}
              canEdit={canEdit}
              onSelectObject={setSelectedId}
              onDeleteObject={(id) => dispatch({ type: "OBJECT_DELETE", id })}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      </Frame>

      <UpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        workspaceId={workspaceId}
        canManageBilling={canManageBilling}
        reason={
          ent.objectCap !== null
            ? `This workspace hit the Starter limit of ${ent.objectCap.toLocaleString()} ontology objects. Nothing was deleted — upgrade to keep adding.`
            : undefined
        }
      />

      {/* The lane it fills in is already behind it; Discard takes that lane back
          off the board, and no request was ever made for it. */}
      <NewObjectDialog
        open={draft.open}
        onDiscard={draft.discard}
        onCreate={draft.create}
      />

      <DeleteClusterDialog
        open={confirmDeleteCluster}
        onOpenChange={setConfirmDeleteCluster}
        graph={graph}
        cluster={cluster}
        onConfirm={handleDeleteCluster}
      />
    </OntologyResourcesProvider>
  );
}

/** Floats the surface as one raised card via the global .page-float. */
function Float({ children }: { children?: React.ReactNode }) {
  return (
    <div className="page-float flex flex-col antialiased">{children}</div>
  );
}

/** Fills a host that is already the page panel — no second card. */
function Fill({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col antialiased">
      {children}
    </div>
  );
}
