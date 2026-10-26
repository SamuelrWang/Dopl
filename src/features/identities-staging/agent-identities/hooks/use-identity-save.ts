"use client";

/**
 * STAGING STUB of `src/features/agent-identities/hooks/use-identity-save.ts`. Same signature and
 * result; writes go to the in-memory store after a short pause (so "Saving…" / "Deleting…" show).
 */
import { useState } from "react";
import type { AgentIdentity, IdentityShelf } from "@/features/agent-identities/client/types";
import {
  optimisticIdentity,
  type IdentityDraft,
} from "@/features/agent-identities/lib/identity-draft";
import { STAGING_USER_ID } from "../../data";
import {
  insertIdentity,
  latency,
  removeIdentity,
  replaceIdentity,
} from "../../identity-store";

export interface IdentitySaveExtras {
  create?: Record<string, unknown>;
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
  noun: string;
  onDone: () => void;
  extras?: (draft: IdentityDraft) => IdentitySaveExtras;
}) {
  void shelf;
  void noun;
  void extras;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function save(draft: IdentityDraft, identity: AgentIdentity | null) {
    setError(null);
    setSaving(true);
    await latency();
    const now = new Date().toISOString();
    if (identity) {
      replaceIdentity({ ...optimisticIdentity(identity, draft), updatedAt: now });
    } else {
      const blank: AgentIdentity = {
        id: "",
        workspaceId,
        name: "",
        description: null,
        instructions: null,
        model: null,
        runtime: null,
        fields: [],
        visibility: draft.visibility,
        teamIds: [],
        knowledgeBases: [],
        knowledge: [],
        unreachableKnowledgeBaseCount: 0,
        createdBy: STAGING_USER_ID,
        createdAt: now,
        updatedAt: now,
      };
      const { id: _drop, ...row } = optimisticIdentity(blank, draft);
      void _drop;
      insertIdentity(row);
    }
    setSaving(false);
    onDone();
  }

  async function remove(identity: AgentIdentity | null) {
    if (!identity) return;
    setError(null);
    setDeleting(true);
    await latency();
    removeIdentity(identity.id);
    setDeleting(false);
    onDone();
  }

  return { save, remove, error, setError, saving, deleting };
}
