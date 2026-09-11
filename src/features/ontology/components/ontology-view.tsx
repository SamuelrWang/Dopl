"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { UpgradeModal } from "@/features/billing/components/upgrade-modal";
import { useWorkspaceEntitlements } from "@/features/billing/components/use-workspace-entitlements";
import { cn } from "@/shared/lib/utils";
import { pendingRow } from "@/shared/ui/pending";
// ⚠ THE APP'S 36px BLACK PILL, AND `src`'s ONLY DECLARATION OF IT
// (`docs/DESIGN-SYSTEM.md`: *"The 36px scale is `bits.tsx › TAB_ACTION`'s alone
// now"*). /home's `panel-buttons.tsx › PAGE_ACTION_BTN` is the same face in the
// downstream `apps/desktop-ui` tree, which this one cannot import — so "+ Object"
// reads the shared constant rather than re-cutting a third copy of `auth-btn-3d
// h-9 rounded-full px-[15px]`.
import { TAB_ACTION } from "@/features/channels/components/channels-v2/bits";
import { useOntology } from "../hooks/use-ontology";
import { OntologyResourcesProvider } from "../hooks/use-workspace-resources";
import { BoardSettingsMenu, DescriptionField, NameField } from "./board-header-bits";
import { CapNotice } from "./cap-notice";
import { ClusterSwitcher, clusterSwitcherEntries } from "./cluster-switcher";
import { DeleteClusterDialog } from "./delete-cluster-dialog";
import { KanbanBoard } from "./kanban-board";
import { ObjectPanel } from "./object-panel";
import { OntologyBoardSkeleton } from "./ontology-skeleton";

interface Props {
  workspaceId: string;
  workspaceSegment: string;
  /** Deep-linked cluster (`/[ws]/ontology/[clusterSlug]`); first cluster when omitted. */
  initialClusterSlug?: string;
  /**
   * SINGLE-ONTOLOGY MODE — pin the board to ONE cluster (2026-09-09, the /home
   * Ontology face; `docs/specs/home-ontology.md` §5).
   *
   * ⚠ **THE VIEW STILL LOADS THE CONTAINER'S WHOLE GRAPH, and that is not a
   * fence hole here**: the container is the caller's OWN personal one, so the
   * snapshot holds nothing they could not open anyway, and the same cache entry
   * backs the list they arrived from (`hooks/use-ontologies.ts`). This prop is a
   * SELECTION, never a permission — the fence is the ontology service's (§4).
   *
   * ⚠ WHAT IT SUPPRESSES, and why each is the HOST's job rather than a style:
   * the board's own DELETE row in the gear menu (the /home delete sits behind a
   * confirm that NAMES the channels the ontology is shared into — Q4 — which this
   * view cannot know, and the gear holds ONE Delete slot, never two), and the URL
   * write (there is no URL on /home). Everything else — the picker, the rename
   * row, the board, the object panel, the editors — is untouched.
   *
   * ⚠ A PIN THAT NAMES NOTHING RESOLVES TO NOTHING, never to `clusters[0]`.
   * Falling back would open a DIFFERENT ontology under the name the operator
   * clicked.
   *
   * ⚠ **THE PIN IS THE HOST'S SELECTION, so a host that offers a picker MOVES
   * it** — pair it with `onSelectCluster`, or the dropdown will change nothing.
   */
  pinnedClusterId?: string;
  /** Host-owned selection: fired beside the view's own state so a PINNED host
   *  can move its pin. Omit and the view keeps selecting for itself. */
  onSelectCluster?: (id: string) => void;
  /**
   * THE PICKER'S CREATE, OVERRIDDEN (the "+ Ontology" row inside the name
   * dropdown — `cluster-switcher.tsx`).
   *
   * ⚠ A PROP RATHER THAN A SLOT SINCE 2026-09-10: it used to be `headerStart`, a
   * black page button /home rendered beside the picker, and Samuel moved it INTO
   * the dropdown — so the host can no longer supply a face, only the act.
   * Omitted ⇒ the view's own optimistic `createCluster`. /home passes its own
   * because the board's optimistic path mints a PROVISIONAL id a host holding a
   * pin would be left pointing at.
   */
  onCreateCluster?: () => void;
  /**
   * THE HOST'S ROWS INSIDE THE HEADER'S GEAR MENU — /home's Share, Changelog, the
   * agents view/edit rungs and Delete.
   *
   * ⚠ **ROWS, NOT A TRIGGER** (2026-09-10, Samuel: the `…` becomes *"a circle
   * … with a settings icon"*). It was `headerEnd`, a node that brought its own
   * button, and two menus in one header is the drift a single trigger removes.
   * Takes the menu's `close` so a row can dismiss it before opening a dialog.
   */
  settingsMenu?: (close: () => void) => ReactNode;
  /** Admin/owner — controls whether the upgrade prompt offers checkout. */
  canManageBilling?: boolean;
  /** Member+ — viewers read but can't create, so create affordances
   *  (New cluster / Column / Add new) are hidden. */
  canEdit?: boolean;
  /**
   * How the address bar follows the active cluster's slug. Defaults to
   * `history.replaceState`; RSC pages pass nothing (a server component can't
   * hand a function to a client component). ⚠ Desktop SPA injects its
   * hash-router equivalent — the packaged renderer is a `file://` document
   * where replacing the path is a Chromium security error.
   */
  replaceUrl?: (path: string) => void;
  /**
   * `true` when the host already IS a floated page panel (the /home pane):
   * the view then fills the host instead of raising a second `.page-float`
   * inside it (Samuel, 2026-09-10: *"the ontology is still on a gray panel.
   * That is on the white panel"*). The workspace page keeps its own float.
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
  // Create renders rows under PROVISIONAL ids, swapped when the POST answers.
  // ⚠ Selection is local state and must move with them, else board + panel
  // blank out exactly when the create succeeds.
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
    createObjectInNewColumn,
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
  const [confirmDeleteCluster, setConfirmDeleteCluster] = useState(false);
  /**
   * RENAMING — the gear's "Rename" row, and the ONLY way to rename an ontology
   * from the board since the name became the switcher's TRIGGER (2026-09-10).
   *
   * ⚠ IT LIVES HERE, not in either child: the row that starts it is in the gear
   * and the field that ends it stands where the switcher does, so neither
   * component can own the flag without reaching across the header.
   */
  const [renaming, setRenaming] = useState(false);

  // ⚠ THE PIN OUTRANKS ALL THREE FALLBACKS AND HAS NONE OF ITS OWN — see the
  // prop's docblock.
  const cluster = pinnedClusterId
    ? (graph.clusters.find((c) => c.id === pinnedClusterId) ?? null)
    : (graph.clusters.find((c) => c.id === clusterId) ??
      graph.clusters.find((c) => c.slug === initialClusterSlug) ??
      graph.clusters[0] ??
      null);
  const selected = selectedId ? (graph.objects[selectedId] ?? null) : null;
  const clusterPending = cluster ? pendingIds.has(cluster.id) : false;
  // ⚠ ONE list for BOTH picker faces, walked once per graph — never per render
  // and never per face (`cluster-switcher.tsx`).
  const entries = useMemo(() => clusterSwitcherEntries(graph), [graph]);

  const selectCluster = (id: string) => {
    setClusterId(id);
    setSelectedId(null);
    setConfirmDeleteCluster(false);
    // A half-typed name belongs to the ontology that was open, not the next one.
    setRenaming(false);
    // ⚠ BESIDE the local write, not instead of it: a PINNED host resolves the
    // cluster from its own state, and an unpinned one from `clusterId`.
    onSelectCluster?.(id);
  };

  // ⚠ Effect, not inline in `selectCluster`: an optimistic cluster is selected
  // BEFORE it has a slug (server mints it, arrives via `CREATE_RESOLVE`). Keyed
  // on slug alone — stable across renames, and an unselected cluster (deep
  // link, first-cluster fallback) leaves the URL untouched.
  // ⚠ NEVER IN PINNED MODE: the host has no URL for the slug to follow.
  const activeSlug =
    !pinnedClusterId && cluster && cluster.id === clusterId ? cluster.slug : null;
  useEffect(() => {
    if (activeSlug) replaceUrl(`/${workspaceSegment}/ontology/${activeSlug}`);
  }, [activeSlug, workspaceSegment, replaceUrl]);

  // Permanent cascading delete. Selection moves to the ADJACENT tab (next,
  // else previous), never index 0: the `?? clusters[0]` display fallback would
  // land on an unrelated board (skills-browser-core `handleDeleted` pattern).
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

  // ⚠ New cluster creates TWO objects (column + first card) → needs headroom
  // of 2, not just under-cap. Otherwise a create at 999/1000 trips the server
  // cap mid-sequence and leaves an orphaned partial cluster.
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
   * "+ Object" — the header's black button since 2026-09-10 (Samuel: *"for the +
   * column button in ontology, change that to instead be the black button … and
   * instead have it say, + Object"*).
   *
   * ⚠ **AN OBJECT IS A CARD, AND A CARD NEEDS A LANE.** With a column on the board
   * the card joins the FIRST one; on an EMPTY board the click MINTS the lane and
   * puts the object in it, rather than opening a dialog to ask which column —
   * "+ Object" that answered with a column picker would be the old button wearing
   * the new word. Column creation itself is still reachable, from the gear menu.
   *
   * ⚠ Two objects need HEADROOM OF 2, not just under-cap — `handleCreateCluster`'s
   * arithmetic, for its reason: a create at 999/1000 trips the server cap
   * mid-sequence and leaves a lane with nothing in it.
   */
  const handleCreateHeaderObject = () => {
    if (!cluster) return;
    const firstColumn = cluster.columnIds[0];
    if (firstColumn !== undefined) {
      handleCreateObject({ parentObjectId: firstColumn });
      return;
    }
    if (
      ent.overCap ||
      (ent.isCapped &&
        ent.objectCap !== null &&
        ent.objectsUsed + 2 > ent.objectCap)
    ) {
      setUpgradeOpen(true);
      return;
    }
    setSelectedId(createObjectInNewColumn(cluster.id).id);
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
    // ⚠ ONE LINE, and it is not the empty state below: "there are none" and
    // "the one you opened is gone" are different answers, and the create button
    // under the second would make an unrelated ontology.
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
              ? "No ontology yet — start with your first cluster."
              : "No ontology yet — a workspace member can create the first cluster."}
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={handleCreateCluster}
              className="auth-btn-3d rounded-lg px-4 py-2 text-lead font-semibold text-white"
            >
              New cluster
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
        {/* ⚠ THE HEADER SITS ON THE PAGE'S OWN WHITE PANEL, and so does the board
            under it (Samuel, 2026-09-10: *"all the elements are like on a gray
            canvas, on top of a white panel. So it looks like double panel"*). No
            surface of its own here, and no dot grid below — `kanban-board.tsx`. */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-3 py-2">
          {/* ⚠ THE ONTOLOGY'S NAME **IS** THE PICKER (2026-09-10) — one control
              where the pill strip and a separate bold name input used to stand …
              ⚠ …and while RENAMING it is the kit's underline field IN THAT SLOT,
              swapped rather than decorated: the chevron belongs to the trigger,
              so it goes with it and nothing hides it separately. */}
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
          {/* ⚠ Inert until cluster is real: an edit on a provisional row would
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
              // ⚠ Both edits are inert on a PROVISIONAL cluster, the Description
              // field's rule: a rename would debounce a PATCH at an id the server
              // has never seen.
              onRename={
                canEdit && !clusterPending ? () => setRenaming(true) : undefined
              }
              onAddColumn={
                canEdit
                  ? () => handleCreateObject({ clusterId: cluster.id })
                  : undefined
              }
              hostRows={settingsMenu}
              // ⚠ **ONE DELETE SLOT, AND THE GEAR IS IT** (2026-09-10) — the
              // standalone trash button that stood here is DELETED. Pinned mode is
              // how a host declares it brings its OWN Delete (/home's confirm
              // NAMES the channels the ontology is lent into — Q4), so exactly one
              // of the two is ever rendered.
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
              onClick={handleCreateHeaderObject}
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

/** Floats the surface as ONE raised card via the global .page-float. */
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
