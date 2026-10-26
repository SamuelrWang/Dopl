"use client";

import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { FormDialog, FormSection, PillChoice } from "@/shared/ui/form-dialog";
import type { Channel } from "@/features/channels/types";
import { deleteOntology } from "../client/api";
import { LEVEL_OPTIONS, useOntologyShares } from "../hooks/use-ontology-shares";
import type { OntologyLevel, OntologyShare } from "../types";

/**
 * Sharing one ontology into the operator's home channels, and the delete confirm that names what
 * the delete takes with it. A share is a reference, never a copy: one ontology lent into N
 * channels, each with three independent audiences (members, guests, the owner's own agents). A
 * person's agents inherit that person's level, so the only agent control is the owner's.
 *
 * `channels` is the host's answer (the operator's home channels from the read the page already
 * mounted), so the popup costs no request and cannot show a room the caller does not reach.
 * `canManage` is the server's, the same predicate the write applies; an unresolved read is not
 * permission.
 */

/** Everything the popup and the confirm need about the row they act on. */
export interface ShareTarget {
  id: string;
  name: string;
}

export type ShareChannel = Pick<Channel, "id" | "name">;

export function OntologyShareDialog({
  workspaceId,
  ontology,
  channels,
  onClose,
}: {
  /** The ontology's own container, the home space, never a channel's. */
  workspaceId: string;
  ontology: ShareTarget;
  channels: readonly ShareChannel[];
  onClose: () => void;
}) {
  const { shares, canManage, resolved, save, saving } = useOntologyShares(
    workspaceId,
    ontology.id
  );
  const [draft, setDraft] = useState<Record<string, OntologyShare> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Seeded from the server once the read lands and never re-seeded: a background refetch
  // mid-edit would discard what the operator chose.
  const rows = useMemo(
    () => draft ?? seedDraft(channels, shares),
    [draft, channels, shares]
  );

  async function commit() {
    setError(null);
    try {
      // Only what moved: opening the dialog and pressing Save creates no share rows.
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
      // The title carries a typed name, which the kit's `capitalize` would recase.
      titleCase={false}
      primary={{
        label: "Save",
        onClick: () => void commit(),
        busy: saving,
        disabled: !canManage,
        hint: canManage ? undefined : "Only the owner can change this.",
      }}
    >
      {channels.map((channel) => {
        // The channel list and the share read land independently, so a channel can arrive after
        // the draft was seeded.
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
              // A disabled pill row would read as an editor that is merely busy.
              <p className="text-caption text-text-muted">{summarize(row)}</p>
            )}
          </FormSection>
        );
      })}
      {!resolved && <p className="text-caption text-text-muted">Loading sharing…</p>}
      {error && <p className="text-caption text-danger">{error}</p>}
    </FormDialog>
  );
}

/**
 * Deleting a shared ontology: the confirm names the channels it is lent into, because the cascade
 * is what the operator cannot see, and it waits for the share read to say so. App-only: the route
 * is `sessionOnly` and MCP has no delete op.
 */
export function DeleteOntologyConfirm({
  workspaceId,
  ontology,
  channels,
  onClose,
  onDeleted,
}: {
  workspaceId: string;
  ontology: ShareTarget;
  channels: readonly ShareChannel[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { shares, resolved } = useOntologyShares(workspaceId, ontology.id);
  const names = shares
    .map(
      (share) =>
        // A channel this payload cannot name is still counted, or the cascade is under-stated.
        channels.find((c) => c.id === share.channelId)?.name ?? "another channel"
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
        await deleteOntology(workspaceId, ontology.id);
        onDeleted();
      }}
    />
  );
}

/** The three audiences a share row states, in the order the popup asks them. "My agents" is the
 *  owner's own sessions in that room. */
const AUDIENCES = [
  { field: "membersLevel", label: "Members" },
  { field: "guestsLevel", label: "Guests" },
  { field: "ownerAgentsLevel", label: "My agents" },
] as const satisfies ReadonlyArray<{
  field: keyof Omit<OntologyShare, "channelId">;
  label: string;
}>;

/** An unshared channel reads as three `none`s, the same answer an absent row gives. */
const NONE: Omit<OntologyShare, "channelId"> = {
  membersLevel: "none",
  guestsLevel: "none",
  ownerAgentsLevel: "none",
};

function seedFor(channelId: string, shares: readonly OntologyShare[]): OntologyShare {
  return shares.find((s) => s.channelId === channelId) ?? { channelId, ...NONE };
}

function seedDraft(
  channels: readonly ShareChannel[],
  shares: readonly OntologyShare[]
): Record<string, OntologyShare> {
  const seeded: Record<string, OntologyShare> = {};
  for (const channel of channels) seeded[channel.id] = seedFor(channel.id, shares);
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
  return AUDIENCES.map(({ field, label }) => `${label}: ${share[field]}`).join(" · ");
}

function describeDelete(names: string[], resolved: boolean): string {
  if (!resolved) return "Checking where this is shared…";
  if (names.length === 0) {
    return "This deletes the ontology and everything in it. It isn't shared into any channel.";
  }
  return `This deletes the ontology and everything in it, and unshares it from ${names.join(", ")}.`;
}
