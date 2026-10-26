"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { History, Share2, Trash2 } from "lucide-react";
import { EmptyLine } from "@/shared/ui/empty-state";
import { OpenScaleButton } from "@/shared/ui/open-scale-button";
import { CreateButton } from "@/shared/ui/page-action-button";
import { PageError } from "@/shared/ui/page-error";
import { MenuDivider, MenuItem } from "@/shared/ui/popover-menu";
import { SectionPanel } from "@/shared/ui/section-panel";
import { createOntology, setAgentsMayEdit } from "../client/api";
import { useRememberOntology } from "../hooks/use-last-opened";
import { useOntologies, type OntologyListRow } from "../hooks/use-ontologies";
import { ontologySnapshotKey } from "../hooks/use-ontology";
import { readMemory, writeFace } from "../last-opened";
import { NEW_ONTOLOGY_NAME } from "../optimistic-create";
import { OntologyChangelog } from "./ontology-changelog";
import {
  DeleteOntologyConfirm,
  OntologyShareDialog,
  type ShareChannel,
  type ShareTarget,
} from "./ontology-share";
import { OntologyView } from "./ontology-view";

/**
 * /home → Ontology: the ontology board for the operator's own home space, with an ontology picker
 * in its header instead of a list. Its rows are personal (ontologies in the caller's `kind='home'`
 * container, never the selected channel's), lent INTO channels, so the face takes no channel.
 *
 * Selection is this component's and reaches the board as `pinnedOntologyId`. /home creates
 * through the API and pins the id the SERVER minted: the board's own create mints provisional ids
 * its reducer later swaps, which a host holding one would be left pointing at.
 *
 * Every /home-only control is a row in the board's gear menu (`OntologyMenuRows`): Share,
 * Changelog, the agents view/edit rungs, Delete. The delete confirm names the channels the
 * ontology is lent into, which the board cannot know.
 *
 * Declared in `src/` so the desktop page and the UI-staging playground mount one component; the
 * host passes its answers in (`homeChannels`).
 */
export function HomeOntologyPanels({
  homeWorkspaceId,
  homeWorkspaceSegment,
  currentUserId,
  homeChannels,
}: {
  /** The home space these rows live in, NULL until the caller is onboarded: unavailable, not
   *  empty. */
  homeWorkspaceId: string | null;
  /** The board takes it for its own URL writes, which pinned mode never makes. */
  homeWorkspaceSegment: string | null;
  /** Scopes this device's last-opened memory (`last-opened.ts`). */
  currentUserId?: string;
  /** The operator's home channels, for the share popup and the delete confirm. */
  homeChannels: readonly ShareChannel[];
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const memory = useMemo(
    () => (homeWorkspaceId ? readMemory(currentUserId, homeWorkspaceId) : null),
    [currentUserId, homeWorkspaceId]
  );
  const [changelogOpen, setChangelogOpen] = useState(() => memory?.face === "changelog");
  const [sharing, setSharing] = useState<ShareTarget | null>(null);
  const [deleting, setDeleting] = useState<ShareTarget | null>(null);
  const [creating, setCreating] = useState(false);
  /**
   * The board's mount generation, bumped when a row is created or deleted outside the board.
   * The board's store stops accepting snapshots once the operator has typed
   * (`use-ontology.ts › dirtyRef`), so an edited board would never learn of the new pin and would
   * answer "This ontology is no longer here." A remount is safe: the store flushes its debounced
   * PATCHes on unmount. Not keyed on the selection, so switching keeps one board and one read.
   */
  const [boardEpoch, setBoardEpoch] = useState(0);
  const { rows, resolved, error, refetch } = useOntologies(homeWorkspaceId);

  // A deleted or not-yet-chosen id falls to the first row, so the pin always names an ontology
  // the graph has. Precedence: a pick this mount › this device's memory › the first row.
  const active =
    rows.find((row) => row.id === selectedId) ??
    rows.find((row) => row.id === memory?.ontologyId) ??
    rows[0] ??
    null;

  useRememberOntology({
    enabled: homeWorkspaceId !== null,
    currentUserId,
    workspaceId: homeWorkspaceId ?? "",
    ontologies: rows,
    status: resolved && !error ? "ready" : "loading",
    openId: active?.id ?? null,
    rememberedId: memory?.ontologyId ?? null,
  });
  const face = changelogOpen ? "changelog" : "board";
  const faceReady = homeWorkspaceId !== null && resolved && active !== null;
  useEffect(() => {
    if (faceReady && homeWorkspaceId) writeFace(currentUserId, homeWorkspaceId, face);
  }, [faceReady, face, currentUserId, homeWorkspaceId]);

  // The remount always follows the invalidate, so the fresh board seeds from a snapshot that
  // already holds (or no longer holds) the row.
  const invalidateSnapshot = (workspaceId: string) =>
    queryClient.invalidateQueries({ queryKey: ontologySnapshotKey(workspaceId) });
  const remountBoard = () => setBoardEpoch((n) => n + 1);

  async function create() {
    if (homeWorkspaceId === null) return;
    setCreating(true);
    try {
      const ontology = await createOntology(homeWorkspaceId, { name: NEW_ONTOLOGY_NAME });
      await invalidateSnapshot(homeWorkspaceId);
      setChangelogOpen(false);
      setSelectedId(ontology.id);
      remountBoard();
    } finally {
      setCreating(false);
    }
  }

  if (homeWorkspaceId === null) {
    return (
      <div className={PANE}>
        <SectionPanel id="home-ontology" label="Ontology">
          <EmptyLine>Finish setting up your home space to keep ontologies here.</EmptyLine>
        </SectionPanel>
      </div>
    );
  }
  if (error) return <PageError error={error} onRetry={refetch} />;
  // Neither sentence may state an emptiness it has not measured: bare until the read resolves.
  if (!resolved) return <div className={PANE} />;
  if (active === null) {
    return (
      <div className={PANE}>
        <SectionPanel
          id="home-ontology"
          label="Ontology"
          action={
            <CreateButton disabled={creating} onClick={() => void create()}>
              Ontology
            </CreateButton>
          }
        >
          <EmptyLine>No ontologies yet.</EmptyLine>
        </SectionPanel>
      </div>
    );
  }

  if (changelogOpen) {
    return (
      <div className={PANE}>
        <div className="flex shrink-0 items-center gap-2">
          <OpenScaleButton onClick={() => setChangelogOpen(false)}>Back</OpenScaleButton>
        </div>
        <SectionPanel id="home-ontology-changelog" label={`${active.name} · Changelog`}>
          {/* /home lists only what the caller owns, so a restore is theirs to make. */}
          <OntologyChangelog ontologyId={active.id} workspaceId={homeWorkspaceId} canEdit />
        </SectionPanel>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <OntologyView
        key={boardEpoch}
        // The pane is the panel: no second float inside it.
        frameless
        workspaceId={homeWorkspaceId}
        workspaceSegment={homeWorkspaceSegment ?? ""}
        pinnedOntologyId={active.id}
        currentUserId={currentUserId}
        onSelectOntology={setSelectedId}
        onCreateOntology={() => {
          if (!creating) void create();
        }}
        settingsMenu={(close) => (
          <OntologyMenuRows
            row={active}
            workspaceId={homeWorkspaceId}
            close={close}
            onShare={() => setSharing({ id: active.id, name: active.name })}
            onChangelog={() => setChangelogOpen(true)}
            onDelete={() => setDeleting({ id: active.id, name: active.name })}
          />
        )}
        // The owner's own container, so the board is editable.
        canEdit
        replaceUrl={NO_URL}
      />

      {sharing && (
        <OntologyShareDialog
          workspaceId={homeWorkspaceId}
          ontology={sharing}
          channels={homeChannels}
          onClose={() => setSharing(null)}
        />
      )}
      {deleting && (
        <DeleteOntologyConfirm
          workspaceId={homeWorkspaceId}
          ontology={deleting}
          channels={homeChannels}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            // Selection moves to the ADJACENT row, the board's own delete rule.
            const at = rows.findIndex((row) => row.id === deleting.id);
            setSelectedId(rows[at + 1]?.id ?? rows[at - 1]?.id ?? null);
            setDeleting(null);
            setChangelogOpen(false);
            void invalidateSnapshot(homeWorkspaceId).finally(remountBoard);
          }}
        />
      )}
    </div>
  );
}

/**
 * The /home rows of the board's gear menu, under its divider; `close` is the menu's. The agents
 * rungs are `agents_may_edit`, which only narrows: an operator's own agents always reach their
 * own ontology, and the toggle picks view or edit.
 */
function OntologyMenuRows({
  row,
  workspaceId,
  close,
  onShare,
  onChangelog,
  onDelete,
}: {
  row: OntologyListRow;
  workspaceId: string;
  close: () => void;
  onShare: () => void;
  onChangelog: () => void;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();

  const setAgents = (mayEdit: boolean) => {
    close();
    void setAgentsMayEdit(workspaceId, row.id, mayEdit).then(() =>
      queryClient.invalidateQueries({ queryKey: ontologySnapshotKey(workspaceId) })
    );
  };
  const act = (then: () => void) => () => {
    close();
    then();
  };

  return (
    <>
      <MenuItem icon={<Share2 size={12} />} onSelect={act(onShare)}>
        Share
      </MenuItem>
      <MenuItem icon={<History size={12} />} onSelect={act(onChangelog)}>
        Changelog
      </MenuItem>
      <MenuDivider />
      <MenuItem showCheck active={!row.agentsMayEdit} onSelect={() => setAgents(false)}>
        Agents can view
      </MenuItem>
      <MenuItem showCheck active={row.agentsMayEdit} onSelect={() => setAgents(true)}>
        Agents can edit
      </MenuItem>
      <MenuDivider />
      <MenuItem destructive icon={<Trash2 size={12} />} onSelect={act(onDelete)}>
        Delete
      </MenuItem>
    </>
  );
}

const PANE = "flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3";

/** /home has no address bar for an ontology slug to follow. */
const NO_URL = () => {};
