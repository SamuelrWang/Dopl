"use client";

/**
 * THE ONE SAVE/DELETE ORCHESTRATION BEHIND `identity-editor.tsx` — create-or-patch, the
 * empty-patch skip, the optimistic body, and the sentence a failure gets.
 *
 * ⚠ **IT IS ONE FUNCTION SINCE 2026-09-17 (P18).** It was written twice — the workspace Agents
 * page (`components/agent-identities-core.tsx`) and /home's authoring modal
 * (`apps/desktop-ui/src/pages/home/identity-editor.tsx`) — and only what each HOST adds to the two
 * bodies ever differed. The F-404 rule (an acknowledgement is spread AFTER the emptiness test,
 * never into it) was stated in one copy and not the other, so the day the other gained an extra
 * field it would have sent a PATCH that alters nothing. It is stated once now, below `patch`.
 *
 * 🔒 **THE DIALOG STAYS OPEN UNTIL THE WRITE SETTLES AND CLOSES ONLY ON SUCCESS** — this tree's
 * idiom (INVARIANTS §5A). The writes are optimistic, so a dialog that closed on the click would
 * leave a failed save with nowhere to report: the row rolls back and the operator's edit is gone
 * with no sentence anywhere saying why. That is why `onDone` is called INSIDE the `try`.
 *
 * ⚠ **THE SHELF IS NOT OPTIONAL-ISH.** It routes a create AND keys the cache entry the optimistic
 * patch addresses (F-331, with the shelf as a second axis); omitting it means BOTH shelves, which
 * looks exactly like working code. Each host passes its own and says why.
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

/** What a host adds to the two bodies. ⚠ Per-draft, because G16's acknowledgement depends on the
 *  visibility the operator just chose. */
export interface IdentitySaveExtras {
  /** Merged into the CREATE body. */
  create?: Record<string, unknown>;
  /** Merged into the PATCH body ⚠ AFTER the emptiness test, never into it: an acknowledgement
   *  moves no column, and counting it as a change sends a PATCH that alters nothing (F-404). */
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
  /** What a failure calls the row — "agent" on /home, "identity" on the Agents page. */
  noun: string;
  /** Closes the host's dialog. ⚠ Called on SUCCESS only — see the docblock. */
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
        // Nothing changed — a PATCH with an empty body is a round trip that can only fail, and
        // Save is the operator saying "I'm done", not "write something".
        if (!isEmptyPatch(body)) {
          await writes.update.mutateAsync({
            identityId: identity.id,
            body: { ...body, ...extra.patch },
            // ⚠ NO NAME LOOKUP SINCE 2026-09-08: the draft holds resolved knowledge REFS, so
            // every chip already carries its own label.
            optimistic: optimisticIdentity(identity, draft),
            // 🔒 THE VERSION THE EDITOR WAS OPENED ON (F-747). The optimistic
            // patch rolls itself back on the 412, so a lost race leaves the
            // operator's typing on screen and the row as the other writer left
            // it.
            expectedUpdatedAt: identity.updatedAt,
          });
        }
      }
      onDone();
    } catch (err) {
      // ⚠ 412 GETS THE EDITOR'S OWN SENTENCE, NOT THE SERVER'S. The server's
      // wording ("Stale write rejected — row was modified at …") is written for
      // an agent reconciling two bodies; an operator needs the one fact and the
      // one action. ⚠ THE REFETCH THAT MAKES "reopen" TRUE is the update
      // mutation's own `onError` (`./use-agent-identity-writes.ts`), where a
      // query client is already in scope — it must not be a second hook here,
      // because this function is mounted by hosts that stub the writes layer.
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
