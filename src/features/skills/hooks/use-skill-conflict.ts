"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readSkillBody } from "@/features/skills/client/api";

export interface SkillConflict {
  /** The body the server currently holds. */
  serverBody: string;
  /** Its `body_updated_at` — the precondition a forced overwrite must send. */
  serverUpdatedAt: string;
}

/**
 * The 412 record for a skill's body: what the server holds while the editor
 * is blocked on the user choosing between it and their own edits.
 *
 * Deliberately writes nothing — resolving a conflict is a save, and every
 * save goes through `useSkillSaveChain` so two can never be in flight at
 * once. This hook only detects and remembers.
 */
export function useSkillConflict(slug: string, workspaceId: string) {
  const [conflict, setConflict] = useState<SkillConflict | null>(null);
  // Mirror for event handlers / unmount cleanup, read through the stable
  // `peek` below. Written in an effect (not during render) per
  // react-hooks/refs; consumers only read it asynchronously, so post-render
  // timing is equivalent.
  const conflictRef = useRef<SkillConflict | null>(null);
  useEffect(() => {
    conflictRef.current = conflict;
  }, [conflict]);

  /** The live conflict, for async readers that must not re-run on it. */
  const peek = useCallback(() => conflictRef.current, []);

  /**
   * Pull the server's current body and record it so the user can decide
   * (Save mine / Discard mine). Returns the snapshot so the caller can adopt
   * `serverUpdatedAt` as its precondition, or null when the pull itself
   * failed — callers decide whether that warrants a toast or a silent retry.
   */
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
