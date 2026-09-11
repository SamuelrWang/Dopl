import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { History, Share2, Trash2 } from "lucide-react";
import { OpenScaleButton } from "@/shared/ui/open-scale-button";
import { MenuDivider, MenuItem } from "@/shared/ui/popover-menu";
import { SectionPanel } from "@/shared/ui/section-panel";
import { OntologyView } from "@/features/ontology/components/ontology-view";
import { ClusterChangelog } from "@/features/ontology/components/cluster-changelog";
import { createCluster, setAgentsMayEdit } from "@/features/ontology/client/api";
import { NEW_CLUSTER_NAME } from "@/features/ontology/optimistic-create";
import { ontologySnapshotKey } from "@/features/ontology/hooks/use-ontology";
import {
  useOntologies,
  type OntologyListRow,
} from "@/features/ontology/hooks/use-ontologies";

import { PageError } from "#/components/page-states";
import { EmptyLine } from "./knowledge-panel-cards";
import { CreateButton } from "./panel-buttons";
import {
  DeleteOntologyConfirm,
  OntologyShareDialog,
  type ShareTarget,
} from "./ontology-share";

/**
 * /home → Ontology. **THE WORKSPACE ONTOLOGY PAGE, RENDERED FOR THE OPERATOR'S
 * OWN CONTAINER** (Samuel, 2026-09-10: *"the UI for the ontology in the home
 * should look a lot more like the ontology for workspaces … instead of the
 * second image"* — the card list with its Open/Share/Changelog/Delete pills).
 *
 * ⚠ **THERE IS NO LIST ANY MORE.** The face IS the board: the same
 * `ontology/components/ontology-view.tsx › OntologyView` the `/[ws]/ontology`
 * page mounts, same header geometry, same kanban. What was a grid of cards is
 * now the SWITCHER in that header — Samuel: *"for the ontology switcher, instead
 * of different tabs, have it be a dropdown"* — so an ontology is opened by
 * naming it, not by finding its card and pressing Open.
 *
 * ⚠ **ITS ROWS ARE STILL PERSONAL** — an ontology is an `ontology_clusters` row
 * in the caller's `kind='personal'` container (INVARIANTS §4A), never the
 * selected channel's. Knowledge and Agents list what is IN the room; this is
 * what the operator OWNS and lends INTO rooms, which is why the face takes no
 * channel at all (`home-tabs.ts › ONTOLOGY_PANE`) and the share popup asks the
 * SERVER for the operator's home channels rather than taking the selected one.
 *
 * ⚠ **SELECTION IS THIS COMPONENT'S, AND IT REACHES THE BOARD AS `pinnedClusterId`.**
 * The board is pinned exactly as it was before the restyle; what changed is that
 * the host now offers a picker for the pin (`onSelectCluster`). ⚠ It must stay
 * that way round: the board's OWN create mints PROVISIONAL ids that its reducer
 * swaps when the POST answers, so a host holding one would be left pointing at
 * an id the graph no longer has. /home therefore creates through the API and
 * selects the id the SERVER minted (see `create` below).
 *
 * ⚠ **EVERY /home-ONLY CONTROL LIVES IN ONE PLACE — the header's GEAR menu**
 * (`OntologyMenuRows`, rendered inside the board's own settings menu): Share,
 * Changelog, the agents view/edit toggle, Delete.
 * They are the host's because none of them is a fact about a board: the delete
 * confirm NAMES the channels the ontology is lent into (Q4), which the view
 * cannot know.
 *
 * ⚠ ONE LAYOUT FOR ALL FIVE TABS (`./index.tsx`): this renders INSIDE the record
 * pane, never moving the conversation column and never going full-width.
 */
export function HomeOntologyPanels({
  homeWorkspaceId,
  homeWorkspaceSegment,
}: {
  /** ⚠ `POST /api/boot`'s `workspace` — the PERSONAL container these rows live
   *  in, NULL until the caller is onboarded. Unavailable, not empty. */
  homeWorkspaceId: string | null;
  /** Same payload's `segment`; the board takes it for its own URL writes, which
   *  pinned mode never makes. */
  homeWorkspaceSegment: string | null;
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [sharing, setSharing] = useState<ShareTarget | null>(null);
  const [deleting, setDeleting] = useState<ShareTarget | null>(null);
  const [creating, setCreating] = useState(false);
  const { rows, resolved, error, refetch } = useOntologies(homeWorkspaceId);

  // ⚠ SELECTION PERSISTS, BUT NEVER DANGLES: a deleted or not-yet-chosen id
  // falls to the first row, so the pin always names a cluster the graph has —
  // the board's own rule is that a pin naming nothing renders "no longer here".
  const active =
    rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;

  async function create() {
    if (homeWorkspaceId === null) return;
    setCreating(true);
    try {
      // ⚠ NOT THE BOARD'S OPTIMISTIC CREATE, and deliberately (see the header):
      // that path mints a provisional id this component would then hold. The
      // POST answers with the real one, which is what the pin takes.
      const cluster = await createCluster(homeWorkspaceId, {
        name: NEW_CLUSTER_NAME,
      });
      await queryClient.invalidateQueries({
        queryKey: ontologySnapshotKey(homeWorkspaceId),
      });
      setChangelogOpen(false);
      setSelectedId(cluster.id);
    } finally {
      setCreating(false);
    }
  }

  if (homeWorkspaceId === null) {
    return (
      <div className={PANE}>
        <SectionPanel id="home-ontology" label="Ontology">
          <EmptyLine>
            Finish setting up your workspace to keep ontologies here.
          </EmptyLine>
        </SectionPanel>
      </div>
    );
  }
  if (error) return <PageError error={error} onRetry={refetch} />;

  // ⚠ NEITHER SENTENCE MAY STATE AN EMPTINESS IT HAS NOT MEASURED (INVARIANTS
  // §5A): the pane stays bare until the read resolves, and a FAILED read is
  // handled above rather than left as "pending forever" (F-339).
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
          <OpenScaleButton onClick={() => setChangelogOpen(false)}>
            Back
          </OpenScaleButton>
        </div>
        {/* ⚠ THE ROLL-UP IS ITS OWN FACE, not a section under the board: it is
            the ontology's whole history, and the board pane is already a
            full-height canvas with a 420px panel beside it. */}
        <SectionPanel id="home-ontology-changelog" label={`${active.name} · Changelog`}>
          <ClusterChangelog
            clusterId={active.id}
            workspaceId={homeWorkspaceId}
            // ⚠ /home lists only what the caller OWNS, so a restore is theirs to
            // make. A peer's reach into a LENT ontology is the service's answer
            // (§4), never a prop composed here.
            canEdit
          />
        </SectionPanel>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <OntologyView
        // ⚠ THE PANE IS THE PANEL. No second float inside it (Samuel, 2026-09-10).
        frameless
        workspaceId={homeWorkspaceId}
        workspaceSegment={homeWorkspaceSegment ?? ""}
        pinnedClusterId={active.id}
        onSelectCluster={setSelectedId}
        // ⚠ THE CREATE IS A ROW IN THE NAME DROPDOWN NOW, not a black button in
        // the header (Samuel, 2026-09-10) — so /home passes the ACT and the
        // switcher owns the face. Still /home's own POST-then-select, for the
        // provisional-id reason in this file's header.
        onCreateCluster={() => {
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
        // ⚠ THE OWNER'S OWN CONTAINER, so the board is editable. A peer's reach
        // into a LENT ontology is the service's answer (§4), never a prop
        // composed here — /home shows only what the caller owns.
        canEdit
        // ⚠ NO URL ON /home. Pinned mode makes no URL write; this is the
        // belt-and-braces half, so a future branch cannot reach `navigate`.
        replaceUrl={NO_URL}
      />

      {sharing && (
        <OntologyShareDialog
          workspaceId={homeWorkspaceId}
          ontology={sharing}
          onClose={() => setSharing(null)}
        />
      )}
      {deleting && (
        <DeleteOntologyConfirm
          workspaceId={homeWorkspaceId}
          ontology={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            // Selection moves to the ADJACENT row, never index 0 — the board's
            // own delete rule, and the reason this handler knows the order.
            const at = rows.findIndex((row) => row.id === deleting.id);
            setSelectedId(rows[at + 1]?.id ?? rows[at - 1]?.id ?? null);
            setDeleting(null);
            setChangelogOpen(false);
            void queryClient.invalidateQueries({
              queryKey: ontologySnapshotKey(homeWorkspaceId),
            });
          }}
        />
      )}
    </div>
  );
}

/**
 * THE /home CONTROLS, ALL FOUR, AS **ROWS IN THE BOARD'S GEAR MENU** — what the
 * card's pill row used to carry (2026-09-10).
 *
 * ⚠ **ROWS, NOT A MENU OF ITS OWN.** This returned a `…` trigger plus its own
 * `Popover` until Samuel made the trigger a settings circle owned by the board
 * (`ontology-view.tsx › BoardSettingsMenu`); the host now contributes its five
 * rows into that one menu, under the divider, and `close` is the menu's.
 *
 * ⚠ **ONE PLACE PER CONTROL.** Nothing here is repeated in the board and nothing
 * was dropped in the restyle: Share and Delete open the dialogs that know about
 * CHANNELS, Changelog raises the day-grouped roll-up, and the two agent rungs
 * are the `agents_may_edit` column.
 *
 * ⚠ **THE AGENTS ROWS ARE `agents_may_edit`, WHICH ONLY EVER NARROWS.** Its two
 * rungs are `view` and `edit` and there is no `none`: an operator's own agents
 * reach their own ontology (Samuel's solo default is "viewable and editable"),
 * and the toggle chooses which of the two.
 *
 * ⚠ THE PANEL'S POSITIONING IS NOT THIS FILE'S ANY MORE — the board's gear opens
 * in coordinate mode for the reason it always did (`.page-float` clips an
 * anchored panel to a sliver), and these rows just ride in it.
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
  /** The board menu's own dismiss — every row closes before it acts. */
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

  return (
    <>
      <MenuItem
        icon={<Share2 size={12} />}
        onSelect={() => {
          close();
          onShare();
        }}
      >
        Share
      </MenuItem>
      <MenuItem
        icon={<History size={12} />}
        onSelect={() => {
          close();
          onChangelog();
        }}
      >
        Changelog
      </MenuItem>
      <MenuDivider />
      <MenuItem
        showCheck
        active={!row.agentsMayEdit}
        onSelect={() => setAgents(false)}
      >
        Agents can view
      </MenuItem>
      <MenuItem
        showCheck
        active={row.agentsMayEdit}
        onSelect={() => setAgents(true)}
      >
        Agents can edit
      </MenuItem>
      <MenuDivider />
      <MenuItem
        destructive
        icon={<Trash2 size={12} />}
        onSelect={() => {
          close();
          onDelete();
        }}
      >
        Delete
      </MenuItem>
    </>
  );
}

const PANE = "flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3";

/** /home has no address bar for a cluster slug to follow. */
const NO_URL = () => {};
