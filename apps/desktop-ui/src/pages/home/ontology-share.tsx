import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { FormDialog, FormSection, PillChoice } from "@/shared/ui/form-dialog";
import { deleteCluster } from "@/features/ontology/client/api";
import {
  LEVEL_OPTIONS,
  useOntologyShares,
} from "@/features/ontology/hooks/use-ontology-shares";
import type { OntologyLevel, OntologyShare } from "@/features/ontology/types";
import { useAccountChannels } from "@/features/channels/hooks/use-channels";
import type { Channel } from "@/features/channels/types";
import { homeChannels } from "./home-rows";

/**
 * SHARING ONE ONTOLOGY INTO HOME CHANNELS — the popup, and the delete confirm
 * that has to name what the delete takes with it (Samuel, 2026-09-09;
 * `docs/specs/home-ontology.md` §5, Q4).
 *
 * 🔒 **A SHARE IS A REFERENCE, NEVER A COPY** (ruling B11, INVARIANTS §5A): one
 * ontology, lent into N channels, and an edit reaches everyone it is lent to.
 * That is why unsharing is a row DELETE and why the ontology keeps living in the
 * operator's own personal container.
 *
 * ⚠ **THREE AUDIENCES PER CHANNEL, NOT ONE**: members, guests, and the OWNER's
 * own agents in that room. Samuel's ruling is that the same ontology in two
 * channels carries two independent answers (I5), so the dialog is a row per
 * channel and never a single global level.
 *
 * ⚠ **A PERSON'S AGENTS INHERIT THAT PERSON'S LEVEL EXACTLY** and there is no
 * control for them here — that is Q1's recommended default, and a second pill
 * per member would be a matrix nobody asked for. The only agent control is the
 * OWNER's, because only the owner's agents can exceed what the room can see.
 *
 * ⚠ **THE CHANNEL LIST IS THE SERVER'S** — `GET /api/channels?scope=account`, the read
 * this page already mounted, so the popup costs no request and cannot show a
 * room the caller does not reach. Home channels only (Q5): a `kind='standard'`
 * workspace channel is out of scope this wave and is not in this payload.
 *
 * 🔒 **`canManage` IS THE SERVER'S TOO**, the same predicate the write applies —
 * so the dialog cannot render an editor for somebody the PUT will refuse. It
 * fails CLOSED: an unresolved or failed read is not permission.
 */

/** Everything the popup and the confirm need about the row they act on. */
export interface ShareTarget {
  id: string;
  name: string;
}

export function OntologyShareDialog({
  workspaceId,
  ontology,
  onClose,
}: {
  /** The ontology's own container — the personal one, never a channel's. */
  workspaceId: string;
  ontology: ShareTarget;
  onClose: () => void;
}) {
  const channels = useHomeChannels();
  const { shares, canManage, resolved, save, saving } = useOntologyShares(
    workspaceId,
    ontology.id
  );
  const [draft, setDraft] = useState<Record<string, OntologyShare> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ⚠ SEEDED FROM THE SERVER ONCE THE READ LANDS, and never re-seeded: a
  // background refetch mid-edit would silently discard what the operator typed.
  const rows = useMemo(
    () => draft ?? seedDraft(channels, shares),
    [draft, channels, shares]
  );

  async function commit() {
    setError(null);
    try {
      // ⚠ ONLY WHAT MOVED. A channel the operator did not touch is not written,
      // so opening the dialog and pressing Save creates no share rows.
      for (const row of Object.values(rows)) {
        if (sameShare(row, seedFor(row.channelId, shares))) continue;
        await save(row);
      }
      onClose();
    } catch {
      setError("Couldn't save. Try again.");
    }
  }

  return (
    <FormDialog
      open
      onDiscard={onClose}
      title={`Share ${ontology.name}`}
      // ⚠ THE TITLE CARRIES A NAME THE OPERATOR TYPED, so the kit's CSS
      // `capitalize` is wrong here: it would render an ontology called
      // "iPhone leads" as "Share IPhone Leads"
      // (`shared/ui/standard-dialog.tsx › DIALOG_TITLE_AS_TYPED`).
      titleCase={false}
      primary={{
        label: "Save",
        onClick: () => void commit(),
        busy: saving,
        disabled: !canManage,
        // ⚠ A DISABLED SUBMIT SAYS WHY (INVARIANTS §8, rule 4).
        hint: canManage ? undefined : "Only the owner can change this.",
      }}
    >
      {channels.map((channel) => {
        // ⚠ FALLS BACK TO THE SEED PER ROW, never to `rows[id]!`: the channel
        // list and the share read land independently, so a channel can arrive
        // AFTER the draft was seeded and would otherwise index to `undefined`.
        const row = rows[channel.id] ?? seedFor(channel.id, shares);
        return (
        <FormSection key={channel.id} label={channel.name}>
          {canManage ? (
            <div className="flex flex-col gap-2">
              {AUDIENCES.map(({ field, label }) => (
                <PillChoice<OntologyLevel>
                  key={field}
                  label={label}
                  options={LEVEL_OPTIONS}
                  value={row[field]}
                  ariaLabel={`${label} in ${channel.name}`}
                  onChange={(next) =>
                    setDraft({
                      ...rows,
                      [channel.id]: { ...row, [field]: next },
                    })
                  }
                />
              ))}
            </div>
          ) : (
            // ⚠ THE READ-ONLY SUMMARY — the same three facts, no control. A
            // disabled pill row would read as an editor that is merely busy.
            <p className="text-caption text-text-muted">{summarize(row)}</p>
          )}
        </FormSection>
        );
      })}
      {!resolved && (
        <p className="text-caption text-text-muted">Loading sharing…</p>
      )}
      {error && <p className="text-caption text-danger">{error}</p>}
    </FormDialog>
  );
}

/**
 * DELETING A SHARED ONTOLOGY — the confirm NAMES the channels it is lent into
 * (Q4), because the cascade is what the operator cannot see.
 *
 * ⚠ APP-ONLY, DELIBERATELY. `DELETE /api/ontology/clusters/[clusterId]` is
 * `sessionOnly` and `dopl_ontology` has no delete op and must not gain one.
 *
 * ⚠ IT WAITS FOR THE SHARE READ. A confirm that offered to delete before it
 * could say what else goes would be the one sentence this dialog exists for,
 * missing.
 */
export function DeleteOntologyConfirm({
  workspaceId,
  ontology,
  onClose,
  onDeleted,
}: {
  workspaceId: string;
  ontology: ShareTarget;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const channels = useHomeChannels();
  const { shares, resolved } = useOntologyShares(workspaceId, ontology.id);
  const names = shares
    .map(
      (share) =>
        channels.find((c) => c.id === share.channelId)?.name ??
        // ⚠ A CHANNEL THIS PAYLOAD CANNOT NAME IS STILL COUNTED. Dropping it
        // would under-state the cascade, which is the one thing this sentence
        // is for.
        "another channel"
    )
    .sort();

  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Delete ${ontology.name}?`}
      description={describeDelete(names, resolved)}
      confirmLabel="Delete"
      onConfirm={async () => {
        await deleteCluster(workspaceId, ontology.id);
        onDeleted();
      }}
    />
  );
}

/**
 * ⚠ THE SAME CACHE ENTRY THE PAGE ALREADY MOUNTED (`GET /api/channels?scope=account`),
 * so this costs no request.
 *
 * ⚠ **AND THE SAME ROWS THE LEFT PANE SHOWS.** `scope=account` answers every
 * container kind; an ontology is shared into HOME channels, so the list goes
 * through `homeRows`' own G3 filter (`home-rows.ts › homeChannels`) rather than
 * restating `container.kind === "link"` here — one filter, one answer.
 */
function useHomeChannels(): readonly Channel[] {
  const query = useAccountChannels();
  return query.data ? homeChannels(query.data) : EMPTY_CHANNELS;
}

/** The three audiences a share row states, in the order the popup asks them. */
const AUDIENCES = [
  { field: "membersLevel", label: "Members" },
  { field: "guestsLevel", label: "Guests" },
  // ⚠ "MY AGENTS" — the OWNER's own sessions in that room, capped by this and
  // seeded from the solo toggle at first share (Q2).
  { field: "ownerAgentsLevel", label: "My agents" },
] as const satisfies ReadonlyArray<{
  field: keyof Omit<OntologyShare, "channelId">;
  label: string;
}>;

/** An unshared channel reads as three `none`s — the same answer an absent row
 *  gives (I4), which is what makes the popup a complete statement. */
const NONE: Omit<OntologyShare, "channelId"> = {
  membersLevel: "none",
  guestsLevel: "none",
  ownerAgentsLevel: "none",
};

function seedFor(
  channelId: string,
  shares: readonly OntologyShare[]
): OntologyShare {
  return shares.find((s) => s.channelId === channelId) ?? { channelId, ...NONE };
}

function seedDraft(
  channels: readonly Channel[],
  shares: readonly OntologyShare[]
): Record<string, OntologyShare> {
  const seeded: Record<string, OntologyShare> = {};
  for (const channel of channels) {
    seeded[channel.id] = seedFor(channel.id, shares);
  }
  return seeded;
}

function sameShare(a: OntologyShare, b: OntologyShare): boolean {
  return (
    a.membersLevel === b.membersLevel &&
    a.guestsLevel === b.guestsLevel &&
    a.ownerAgentsLevel === b.ownerAgentsLevel
  );
}

/** The read-only face of one row: label + value, nothing else. */
function summarize(share: OntologyShare): string {
  return AUDIENCES.map(({ field, label }) => `${label}: ${share[field]}`).join(
    " · "
  );
}

/** ⚠ THE COUNT AND THE NAMES, because "shared into 2 channels" without them is
 *  a warning the operator cannot act on. */
function describeDelete(names: string[], resolved: boolean): string {
  if (!resolved) return "Checking where this is shared…";
  if (names.length === 0) {
    return "This deletes the ontology and everything in it. It isn't shared into any channel.";
  }
  return `This deletes the ontology and everything in it, and unshares it from ${names.join(", ")}.`;
}

const EMPTY_CHANNELS = Object.freeze([]) as readonly Channel[];
