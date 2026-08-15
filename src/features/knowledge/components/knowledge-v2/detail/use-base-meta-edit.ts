"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KB_BASE_DESCRIPTION_MAX } from "@/config";
import { toast } from "@/shared/ui/toast";
import { KnowledgeApiError, updateBase } from "../../../client/api";
import type { KnowledgeBase } from "../../../types";

/** Text-input debounce, per the §15 200ms guideline with headroom. */
const SAVE_DEBOUNCE_MS = 400;

interface Draft {
  name: string;
  description: string;
}

/**
 * Editable name/description for the base overview card: optimistic local
 * state, debounced `updateBase` PATCH, ⚠ flushed on blur AND unmount so an
 * edit inside the debounce window survives a base switch. `onSaved` lets the
 * caller re-pull the base list (list row + toolbar title in sync).
 *
 * Seeds once from `base`; the overview keys by base id, so a base switch
 * remounts with fresh values rather than reconciling in place.
 */
export function useBaseMetaEdit(
  base: KnowledgeBase,
  workspaceId: string,
  onSaved?: () => void
) {
  const [name, setName] = useState(base.name);
  const [description, setDescription] = useState(base.description ?? "");

  const draftRef = useRef<Draft>({
    name: base.name,
    description: base.description ?? "",
  });
  const savedRef = useRef<Draft>({
    name: base.name,
    description: base.description ?? "",
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  });

  const persist = useCallback(async () => {
    const draft = draftRef.current;
    const saved = savedRef.current;
    const nextName = draft.name.trim();
    const nextDescription = draft.description.trim();

    const patch: { name?: string; description?: string | null } = {};
    if (nextName && nextName !== saved.name) patch.name = nextName;
    if (nextDescription !== saved.description) {
      patch.description = nextDescription === "" ? null : nextDescription;
    }
    if (patch.name === undefined && patch.description === undefined) return;

    try {
      await updateBase(base.id, patch, workspaceId);
      savedRef.current = {
        name: patch.name ?? saved.name,
        description:
          patch.description === undefined
            ? saved.description
            : (patch.description ?? ""),
      };
      onSavedRef.current?.();
    } catch (err) {
      const message =
        err instanceof KnowledgeApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Save failed";
      toast({ title: "Couldn't save", description: message });
    }
  }, [base.id, workspaceId]);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void persist();
    }, SAVE_DEBOUNCE_MS);
  }, [persist]);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void persist();
  }, [persist]);

  const onNameChange = useCallback(
    (value: string) => {
      setName(value);
      draftRef.current = { ...draftRef.current, name: value };
      schedule();
    },
    [schedule]
  );

  const onDescriptionChange = useCallback(
    (value: string) => {
      const clipped = value.slice(0, KB_BASE_DESCRIPTION_MAX);
      setDescription(clipped);
      draftRef.current = { ...draftRef.current, description: clipped };
      schedule();
    },
    [schedule]
  );

  // Flush pending save on unmount (base switch / navigation).
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        void persist();
      }
    };
  }, [persist]);

  return { name, description, onNameChange, onDescriptionChange, flush };
}
