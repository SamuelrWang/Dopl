"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteOntologyShare,
  fetchOntologyShares,
  putOntologyShare,
} from "../client/api";
import { ontologySnapshotKey } from "./use-ontology";
import {
  ONTOLOGY_LEVELS,
  type OntologyLevel,
  type OntologyShare,
} from "../types";

/** TanStack key for one ontology's share rows. Cluster-scoped, because the route
 *  is: one dialog, one read, whatever the container's channel fan is. */
export const ontologySharesKey = (workspaceId: string, clusterId: string) =>
  ["ontology-shares", workspaceId, clusterId] as const;

/** A share row is unshared, not stored, when all three audiences are `none` (I4).
 *  One place decides it, so the dialog and the write cannot disagree. */
export function isUnshared(share: OntologyShare): boolean {
  return (
    share.membersLevel === "none" &&
    share.guestsLevel === "none" &&
    share.ownerAgentsLevel === "none"
  );
}

/**
 * One ontology's shares: the read behind the share dialog and the delete confirm
 * that has to name the channels (Q4).
 *
 * `canManage` comes off the server and is never decided here — it is the same
 * predicate the write applies (spec §5), so a dialog that guessed would render an
 * editor for a caller the PUT then refuses.
 *
 * The writes invalidate TWO entries, and forgetting the second is silent: this key
 * holds the rows, `ontologySnapshotKey` holds the card's `sharedChannelCount`.
 */
export function useOntologyShares(
  workspaceId: string | null,
  clusterId: string | null
): {
  shares: readonly OntologyShare[];
  canManage: boolean;
  resolved: boolean;
  error: unknown;
  save: (share: OntologyShare) => Promise<void>;
  saving: boolean;
} {
  const queryClient = useQueryClient();
  const enabled = workspaceId !== null && clusterId !== null;
  const query = useQuery({
    queryKey: ontologySharesKey(workspaceId ?? "", clusterId ?? ""),
    queryFn: () => fetchOntologyShares(workspaceId as string, clusterId as string),
    enabled,
    refetchOnWindowFocus: false,
  });

  const mutation = useMutation({
    mutationFn: (share: OntologyShare) =>
      // Unsharing is a row delete (I4): `none` is a stored value for one audience
      // of a live row, and writing three of them would leave a lend nobody can
      // see standing.
      isUnshared(share)
        ? deleteOntologyShare(
            workspaceId as string,
            clusterId as string,
            share.channelId
          )
        : putOntologyShare(workspaceId as string, clusterId as string, share),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ontologySharesKey(workspaceId ?? "", clusterId ?? ""),
      });
      // The second entry — the card's share count rides the snapshot.
      void queryClient.invalidateQueries({
        queryKey: ontologySnapshotKey(workspaceId ?? ""),
      });
    },
  });

  return {
    shares: query.data?.shares ?? EMPTY_SHARES,
    // Fail closed: an unresolved or failed read is not permission to manage.
    canManage: query.data?.canManage ?? false,
    resolved: query.data !== undefined,
    error: query.error,
    save: (share) => mutation.mutateAsync(share).then(() => undefined),
    saving: mutation.isPending,
  };
}

/** The visible word for each rung. Sentence case, one word each — label +
 *  control, nothing else (INVARIANTS §5, minimal copy). */
const LEVEL_LABELS: Record<OntologyLevel, string> = {
  none: "None",
  view: "View",
  edit: "Edit",
};

/**
 * The three rungs as a `PillChoice` roster, in ladder order. Derived from
 * `ONTOLOGY_LEVELS`, never hand-typed: the order IS the ladder (`none < view <
 * edit`, I2), and a hand-typed roster is how a fourth spelling of a stored level
 * reaches a control that then writes it.
 */
export const LEVEL_OPTIONS = ONTOLOGY_LEVELS.map((key) => ({
  key,
  label: LEVEL_LABELS[key],
})) satisfies ReadonlyArray<{ key: OntologyLevel; label: string }>;

const EMPTY_SHARES = Object.freeze([]) as readonly OntologyShare[];
