"use client";

/**
 * STAND-IN for `agent-identities/hooks/use-identity-save.ts`: the same result; writes go to the
 * in-memory store after a short pause, so "Saving…" / "Deleting…" show.
 */
import { useState } from "react";
import type { AgentIdentity } from "@/features/agent-identities/client/types";
import {
  optimisticIdentity,
  type IdentityDraft,
} from "@/features/agent-identities/lib/identity-draft";
import { STAGING_USER_ID } from "../data";
import { insertIdentity, latency, removeIdentity, replaceIdentity } from "./identity-store";

export function useStagingIdentitySave({
  workspaceId,
  onDone,
}: {
  workspaceId: string;
  onDone: () => void;
}) {
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
