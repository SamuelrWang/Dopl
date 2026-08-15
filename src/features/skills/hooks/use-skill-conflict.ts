"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readSkillBody } from "@/features/skills/client/api";

export interface SkillConflict {
  /** The body the server currently holds. */
  serverBody: string;
  /** `body_updated_at` — the precondition a forced overwrite must send. */
  serverUpdatedAt: string;
}

/** The 412 record for a skill's body: what the server holds while the editor
 *  waits on the user's choice. ⚠ Writes nothing — resolving a conflict is a
 *  save, and every save goes through `useSkillSaveChain` so two are never in
 *  flight. This hook only detects and remembers. */
export function useSkillConflict(slug: string, workspaceId: string) {
  const [conflict, setConflict] = useState<SkillConflict | null>(null);
  // Mirror for event handlers / unmount cleanup, read via the stable `peek`.
  // Written in an effect, not during render (react-hooks/refs); consumers read
  // it asynchronously, so post-render timing is equivalent.
  const conflictRef = useRef<SkillConflict | null>(null);
  useEffect(() => {
    conflictRef.current = conflict;
  }, [conflict]);

  /** The live conflict, for async readers that must not re-run on it. */
  const peek = useCallback(() => conflictRef.current, []);

  /** Pull + record the server's body so the user can decide. Returns the
   *  snapshot (caller adopts `serverUpdatedAt` as its precondition), or null
   *  when the pull itself failed. */
  const capture = useCallback(async (): Promise<SkillConflict | null> => {
    try {
      const fresh = await readSkillBody(slug, workspaceId);
      const next = { serverBody: fresh.body, serverUpdatedAt: fresh.updatedAt };
      setConflict(next);
      return next;
    } catch {
      return null;
    }
  }, [slug, workspaceId]);

  const clear = useCallback(() => setConflict(null), []);

  return { conflict, peek, capture, clear };
}
