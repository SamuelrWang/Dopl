import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { History, Share2, Trash2 } from "lucide-react";
import { OpenScaleButton } from "@/shared/ui/open-scale-button";
import { MenuDivider, MenuItem } from "@/shared/ui/popover-menu";
import { SectionPanel } from "@/shared/ui/section-panel";
import { OntologyView } from "@/features/ontology/components/ontology-view";
import { OntologyChangelog } from "@/features/ontology/components/ontology-changelog";
import { createOntology, setAgentsMayEdit } from "@/features/ontology/client/api";
import { NEW_ONTOLOGY_NAME } from "@/features/ontology/optimistic-create";
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
 * ⚠ **ITS ROWS ARE STILL PERSONAL** — an ontology is an `ontologies` row
 * in the caller's `kind='home'` container (INVARIANTS §4A), never the
 * selected channel's. Knowledge and Agents list what is IN the room; this is
 * what the operator OWNS and lends INTO rooms, which is why the face takes no
 * channel at all (`home-tabs.ts › ONTOLOGY_PANE`) and the share popup asks the
 * SERVER for the operator's home channels rather than taking the selected one.
 *
 * ⚠ **SELECTION IS THIS COMPONENT'S, AND IT REACHES THE BOARD AS `pinnedOntologyId`.**
 * The board is pinned exactly as it was before the restyle; what changed is that
 * the host now offers a picker for the pin (`onSelectOntology`). ⚠ It must stay
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
  /** ⚠ `POST /api/boot`'s `workspace` — the HOME space these rows live
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
  /**
   * 🔒 **THE BOARD'S MOUNT GENERATION — bumped when a row is CREATED or DELETED
   * OUTSIDE the board, which on this face is both of them.**
   *
   * ⚠ **IT EXISTS BECAUSE THE BOARD'S STORE STOPS ACCEPTING SNAPSHOTS ONCE THE
   * OPERATOR HAS TYPED.** `use-ontology.ts › dirtyRef` is the guard that keeps a
   * background refetch from clobbering a half-typed field: after ANY local
   * dispatch the reducer ignores every later `SNAPSHOT_SET` for the life of the
   * mount. /home writes through the API and moves its PIN to the id the server
   * minted — so on an edited board the pin named an ontology the reducer had never
   * heard of, and `ontology-view.tsx` answered with **"This ontology is no
   * longer here."**, its sentence for a DELETED ontology, over one created a
   * moment earlier. A delete was the milder half of the same drift: the removed
   * row stayed in the switcher's list until something else remounted the board.
   *
   * ⚠ **A REMOUNT IS THE ONLY LEVER THE HOST HAS, and it is safe**: the store
   * FLUSHES its debounced PATCHes on unmount rather than dropping them
   * (`use-ontology.ts`, the timers cleanup), so nothing typed is lost. ⚠ It is
   * NOT keyed on `active.id` — switching ontologies must keep one board and one
   * snapshot read, which is the whole reason the pin is a prop.
   */
  const [boardEpoch, setBoardEpoch] = useState(0);
  const { rows, resolved, error, refetch } = useOntologies(homeWorkspaceId);

  // ⚠ SELECTION PERSISTS, BUT NEVER DANGLES: a deleted or not-yet-chosen id
  // falls to the first row, so the pin always names an ontology the graph has —
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
      const ontology = await createOntology(homeWorkspaceId, {
        name: NEW_ONTOLOGY_NAME,
      });
      await queryClient.invalidateQueries({
        queryKey: ontologySnapshotKey(homeWorkspaceId),
      });
      setChangelogOpen(false);
      setSelectedId(ontology.id);
      // ⚠ AFTER the invalidate, so the fresh mount seeds from a snapshot that
      // already holds the new row. See `boardEpoch`.
      setBoardEpoch((n) => n + 1);
    } finally {
      setCreating(false);
    }
  }

  if (homeWorkspaceId === null) {
    return (
      <div className={PANE}>
        <SectionPanel id="home-ontology" label="Ontology">
          <EmptyLine>
            Finish setting up your home space to keep ontologies here.
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
          <OntologyChangelog
            ontologyId={active.id}
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
        // ⚠ THE MOUNT GENERATION, NOT THE SELECTION — see `boardEpoch` above.
        key={boardEpoch}
        // ⚠ THE PANE IS THE PANEL. No second float inside it (Samuel, 2026-09-10).
        frameless
        workspaceId={homeWorkspaceId}
        workspaceSegment={homeWorkspaceSegment ?? ""}
        pinnedOntologyId={active.id}
        onSelectOntology={setSelectedId}
        // ⚠ THE CREATE IS A ROW IN THE NAME DROPDOWN NOW, not a black button in
        // the header (Samuel, 2026-09-10) — so /home passes the ACT and the
        // switcher owns the face. Still /home's own POST-then-select, for the
        // provisional-id reason in this file's header.
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
            void queryClient
              .invalidateQueries({
                queryKey: ontologySnapshotKey(homeWorkspaceId),
              })
              // ⚠ Same reason as the create: an edited board's reducer will not
              // take the post-delete snapshot, so the removed row would sit in
              // the switcher until something else remounted it.
              .finally(() => setBoardEpoch((n) => n + 1));
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

/** /home has no address bar for an ontology slug to follow. */
const NO_URL = () => {};
