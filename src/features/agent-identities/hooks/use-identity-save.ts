"use client";

/**
 * The one save/delete orchestration behind the identity editor hosts. The dialog closes on success
 * only (`onDone` inside the `try`) — the writes are optimistic, so a failure needs a place to say so.
 */

import { useState } from "react";
import { AgentIdentityApiError, agentIdentityErrorMessage } from "../client/api";
import type { AgentIdentity, IdentityShelf } from "../client/types";
import { useAgentIdentityWrites } from "./use-agent-identity-writes";
import {
  draftToCreateBody,
  draftToPatchBody,
  isEmptyPatch,
  optimisticIdentity,
  type IdentityDraft,
} from "../lib/identity-draft";

/** What a host adds to the two bodies, per draft (G16's acknowledgement depends on the visibility). */
export interface IdentitySaveExtras {
  /** Merged into the CREATE body. */
  create?: Record<string, unknown>;
  /** Merged into the PATCH body after the emptiness test: an acknowledgement alone must not PATCH (F-404). */
  patch?: Record<string, unknown>;
}

export function useIdentitySave({
  workspaceId,
  shelf,
  noun,
  onDone,
  extras,
}: {
  workspaceId: string;
  shelf?: IdentityShelf;
  /** What a failure calls the row ("identity"). */
  noun: string;
  /** Closes the host's dialog; called on success only. */
  onDone: () => void;
  extras?: (draft: IdentityDraft) => IdentitySaveExtras;
}) {
  const writes = useAgentIdentityWrites(workspaceId, shelf);
  const [error, setError] = useState<string | null>(null);

  async function save(draft: IdentityDraft, identity: AgentIdentity | null) {
    setError(null);
    const extra = extras?.(draft) ?? {};
    try {
      if (!identity) {
        await writes.create.mutateAsync({
          body: { ...draftToCreateBody(draft), ...extra.create },
        });
      } else {
        const body = draftToPatchBody(draft, identity);
        // Nothing changed: Save just closes.
        if (!isEmptyPatch(body)) {
          await writes.update.mutateAsync({
            identityId: identity.id,
            body: { ...body, ...extra.patch },
            optimistic: optimisticIdentity(identity, draft),
            // The version the editor was opened on (F-747).
            expectedUpdatedAt: identity.updatedAt,
          });
        }
      }
      onDone();
    } catch (err) {
      // A 412 gets the operator's sentence; the refetch that makes "reopen" true is the update's `onError`.
      if (err instanceof AgentIdentityApiError && err.status === 412) {
        setError(`This ${noun} changed elsewhere. Reopen it to see the current version.`);
        return;
      }
      setError(agentIdentityErrorMessage(err, `Couldn't save the ${noun}`));
    }
  }

  async function remove(identity: AgentIdentity | null) {
    if (!identity) return;
    setError(null);
    try {
      await writes.remove.mutateAsync({ identityId: identity.id });
      onDone();
    } catch (err) {
      setError(agentIdentityErrorMessage(err, `Couldn't delete the ${noun}`));
    }
  }

  return {
    save,
    remove,
    error,
    /** Hosts clear it when they open or close the dialog. */
    setError,
    saving: writes.create.pending || writes.update.pending,
    deleting: writes.remove.pending,
  };
}
