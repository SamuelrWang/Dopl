"use client";

/**
 * STAGING STAND-IN for `src/features/ontology/hooks/use-ontology-shares.ts`:
 * same return shape and the same `LEVEL_OPTIONS`; rows live in the staging store.
 * The operator owns every home ontology, so `canManage` is true.
 * ⚠ PORTING: do not port this file (LEVEL_OPTIONS is re-exported from the real one).
 */

import { useState } from "react";
import type { OntologyShare } from "@/features/ontology/types";
import { useStagingOntologyStore } from "../../store/staging-ontology-store";

export { LEVEL_OPTIONS } from "@/features/ontology/hooks/use-ontology-shares";

export function useOntologyShares(
  workspaceId: string | null,
  ontologyId: string | null
): {
  shares: readonly OntologyShare[];
  canManage: boolean;
  resolved: boolean;
  error: unknown;
  save: (share: OntologyShare) => Promise<void>;
  saving: boolean;
} {
  const store = useStagingOntologyStore();
  const [saving, setSaving] = useState(false);
  const enabled = workspaceId !== null && ontologyId !== null;
  return {
    shares: (enabled && store.shares[ontologyId]) || EMPTY_SHARES,
    canManage: enabled,
    resolved: enabled,
    error: null,
    save: async (share) => {
      if (!ontologyId) return;
      setSaving(true);
      try {
        await store.saveShare(ontologyId, share);
      } finally {
        setSaving(false);
      }
    },
    saving,
  };
}

const EMPTY_SHARES = Object.freeze([]) as readonly OntologyShare[];
