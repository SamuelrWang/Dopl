import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { OpenScaleButton } from "@/shared/ui/open-scale-button";
import { PillChoice } from "@/shared/ui/form-dialog";
import { SectionPanel } from "@/shared/ui/section-panel";
import { OntologyView } from "@/features/ontology/components/ontology-view";
import { ClusterChangelog } from "@/features/ontology/components/cluster-changelog";
import { createCluster, setAgentsMayEdit } from "@/features/ontology/client/api";
import { NEW_CLUSTER_NAME } from "@/features/ontology/optimistic-create";
import {
  ontologySnapshotKey,
} from "@/features/ontology/hooks/use-ontology";
import {
  useOntologies,
  type OntologyListRow,
} from "@/features/ontology/hooks/use-ontologies";

import type { OntologyLevel } from "@/features/ontology/types";
import { PageError } from "#/components/page-states";
import { EmptyLine } from "./knowledge-panel-cards";
import { CreateButton } from "./panel-buttons";
import {
  DeleteOntologyConfirm,
  OntologyShareDialog,
  type ShareTarget,
} from "./ontology-share";

/**
 * /home → Ontology. THE CALLER'S OWN ONTOLOGIES, AND WHO ELSE REACHES THEM
 * (Samuel, 2026-09-09; `docs/specs/home-ontology.md` S4).
 *
 * ⚠ **ONE SECTION, AND ITS ROWS ARE PERSONAL** — "these are ontologies that will
 * be associated with the user's home space. A user can have multiple
 * ontologies." An ontology is a `ontology_clusters` row in the caller's
 * `kind='personal'` container (INVARIANTS §4A), NOT in the selected channel's
 * link container, which is what separates this face from Knowledge and Agents
 * beside it: those list what is IN the room, this lists what the operator OWNS
 * and lends INTO rooms.
 *
 * ⚠ **THE FACE TAKES NO CHANNEL AT ALL, AND THAT IS THE CONSEQUENCE.** Knowledge
 * and Agents are keyed by the selected row because they render that channel's
 * contents; this one renders the same rows whichever row is selected, so it is
 * cross-channel exactly as Overview is (`home-tabs.ts › ONTOLOGY_PANE`). The
 * share popup asks the SERVER for the operator's home channels rather than
 * taking the selected one, so a lend is a deliberate pick and not a side effect
 * of what the list happened to be on.
 *
 * ⚠ **THE BOARD IS REUSED BY IMPORT, PINNED TO ONE CLUSTER.** Opening a card
 * mounts `ontology/components/ontology-view.tsx › OntologyView` with
 * `pinnedClusterId`, which drops that view's cluster strip, its New-cluster
 * button, its delete and its URL write and changes nothing else. It reads the
 * SAME `ontologySnapshotKey` entry this list does, so opening one costs no
 * request.
 *
 * ⚠ **THE SOLO TOGGLE IS ON THE CARD, NOT IN THE POPUP** (Samuel: "for channels
 * with only the user, private ontologies are automatically viewable and editable
 * by their agents. but there should be a setting, where they can toggle it so
 * that their agents can only view"). It is a property of the ONTOLOGY, so it
 * lives where the ontology is listed; the popup is about CHANNELS.
 *
 * ⚠ ONE LAYOUT FOR ALL FIVE TABS (`index.tsx`): this renders INSIDE the record
 * pane. It never moves the conversation column and it never goes full-width.
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [changelogId, setChangelogId] = useState<string | null>(null);
  const [sharing, setSharing] = useState<ShareTarget | null>(null);
  const [deleting, setDeleting] = useState<ShareTarget | null>(null);
  const [creating, setCreating] = useState(false);
  const { rows, resolved, error, refetch } = useOntologies(homeWorkspaceId);

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

  const changelog = rows.find((row) => row.id === changelogId) ?? null;
  if (changelogId !== null && changelog !== null) {
    return (
      <div className={PANE}>
        <div className="flex shrink-0 items-center gap-2">
          <OpenScaleButton onClick={() => setChangelogId(null)}>
            All ontologies
          </OpenScaleButton>
        </div>
        {/* ⚠ THE ROLL-UP IS ITS OWN FACE, not a section under the board: it is
            the ontology's whole history, and the board pane is already a
            full-height canvas with a 420px panel beside it. */}
        <SectionPanel id="home-ontology-changelog" label={`${changelog.name} · Changelog`}>
          <ClusterChangelog
            clusterId={changelog.id}
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

  const open = rows.find((row) => row.id === openId) ?? null;
  if (openId !== null && open !== null) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden p-3">
        <div className="flex shrink-0 items-center gap-2">
          <OpenScaleButton onClick={() => setOpenId(null)}>
            All ontologies
          </OpenScaleButton>
        </div>
        <OntologyView
          workspaceId={homeWorkspaceId}
          workspaceSegment={homeWorkspaceSegment ?? ""}
          pinnedClusterId={open.id}
          // ⚠ THE OWNER'S OWN CONTAINER, so the board is editable. A peer's
          // reach into a LENT ontology is the service's answer (§4), never a
          // prop composed here — /home lists only what the caller owns.
          canEdit
          // ⚠ NO URL ON /home. Pinned mode makes no URL write; this is the
          // belt-and-braces half, so a future branch cannot reach `navigate`.
          replaceUrl={NO_URL}
        />
      </div>
    );
  }

  async function create() {
    setCreating(true);
    try {
      // ⚠ NOT OPTIMISTIC, and deliberately: the optimistic path lives in the
      // BOARD's store (`optimistic-create.ts`), which is a reducer this list
      // does not mount. A list is a query — so the create lands, the snapshot
      // entry is invalidated, and the row arrives with the refetch.
      const cluster = await createCluster(homeWorkspaceId as string, {
        name: NEW_CLUSTER_NAME,
      });
      await queryClient.invalidateQueries({
        queryKey: ontologySnapshotKey(homeWorkspaceId as string),
      });
      setOpenId(cluster.id);
    } finally {
      setCreating(false);
    }
  }

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
        {/* ⚠ NEITHER SENTENCE MAY STATE AN EMPTINESS IT HAS NOT MEASURED
            (INVARIANTS §5A): the body stays bare until the read resolves, and a
            FAILED read is handled above rather than left as "pending forever"
            (F-339). */}
        {!resolved ? (
          <div className="h-10" />
        ) : rows.length === 0 ? (
          <EmptyLine>No ontologies yet.</EmptyLine>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {rows.map((row) => (
              <OntologyCard
                key={row.id}
                row={row}
                workspaceId={homeWorkspaceId}
                onOpen={() => setOpenId(row.id)}
                onShare={() => setSharing({ id: row.id, name: row.name })}
                onDelete={() => setDeleting({ id: row.id, name: row.name })}
                onChangelog={() => setChangelogId(row.id)}
              />
            ))}
          </div>
        )}
      </SectionPanel>

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
            setDeleting(null);
            if (openId === deleting.id) setOpenId(null);
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
 * ONE ONTOLOGY — what it is, how big it is, who else reaches it, and the solo
 * toggle.
 *
 * ⚠ **"Shared into N channels" IS OMITTED WHEN THE PAYLOAD DID NOT CARRY IT**,
 * never rendered as zero (INVARIANTS §8, and `use-ontologies.ts` carries the
 * fallback rule): a stale cached snapshot has no share counts, and "0 channels"
 * would be a claim about rows nobody read.
 *
 * ⚠ **THE AGENTS PILL IS THE `agents_may_edit` COLUMN, WHICH ONLY EVER
 * NARROWS.** Its two rungs are `view` and `edit` and there is no `none`: an
 * operator's own agents reach their own ontology (Samuel's solo default is
 * "viewable and editable"), and the toggle chooses which of the two.
 */
function OntologyCard({
  row,
  workspaceId,
  onOpen,
  onShare,
  onDelete,
  onChangelog,
}: {
  row: OntologyListRow;
  workspaceId: string;
  onOpen: () => void;
  onShare: () => void;
  onDelete: () => void;
  /** The day-grouped roll-up of everything that changed in this ontology. */
  onChangelog: () => void;
}) {
  const queryClient = useQueryClient();
  return (
    <div className="bento flex min-w-0 flex-col gap-2 p-3">
      <p className="truncate text-body font-semibold text-text-primary">
        {row.name}
      </p>
      <p className="text-caption text-text-muted">
        {row.objectCount} {row.objectCount === 1 ? "object" : "objects"}
        {row.sharedChannelCount !== null &&
          ` · shared into ${row.sharedChannelCount} ${
            row.sharedChannelCount === 1 ? "channel" : "channels"
          }`}
      </p>
      <PillChoice<AgentsLevel>
        label="Agents"
        options={AGENT_OPTIONS}
        value={row.agentsMayEdit ? "edit" : "view"}
        ariaLabel={`Agents on ${row.name}`}
        onChange={(next) => {
          void setAgentsMayEdit(workspaceId, row.id, next === "edit").then(() =>
            queryClient.invalidateQueries({
              queryKey: ontologySnapshotKey(workspaceId),
            })
          );
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <OpenScaleButton onClick={onOpen}>Open</OpenScaleButton>
        <OpenScaleButton onClick={onShare}>Share</OpenScaleButton>
        <OpenScaleButton onClick={onChangelog}>Changelog</OpenScaleButton>
        <OpenScaleButton onClick={onDelete}>Delete</OpenScaleButton>
      </div>
    </div>
  );
}

/** The two rungs the SOLO toggle offers — a subset of the ladder, named from
 *  it so the two vocabularies cannot drift. */
type AgentsLevel = Extract<OntologyLevel, "view" | "edit">;
const AGENT_OPTIONS: ReadonlyArray<{ key: AgentsLevel; label: string }> = [
  { key: "view", label: "View" },
  { key: "edit", label: "Edit" },
];

const PANE = "flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3";

/** /home has no address bar for a cluster slug to follow. */
const NO_URL = () => {};
