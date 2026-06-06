"use client";

import { useCallback, useEffect, useState } from "react";

interface ApiKeyRow {
  id: string;
  key_prefix: string;
  name: string;
  revoked_at: string | null;
}

export interface WorkspaceKeyState {
  /** Metadata of the workspace's single active key, or null if none. */
  active: { id: string; prefix: string } | null;
  /** Revealed plaintext (for the key chip + snippets). Null when there's
   *  no active key OR the active key predates encrypted storage. */
  plaintext: string | null;
  isLoading: boolean;
  /** Generate the workspace key (no-op + sets error if one is active). */
  generate: () => Promise<void>;
  /** Revoke the active key. */
  revoke: () => Promise<void>;
  /** Non-fatal error message (e.g. "revoke the existing key first"). */
  error: string | null;
  clearError: () => void;
}

/**
 * Owns the single workspace-scoped API key for the unified setup surface.
 * Standardizes on the `/api/workspaces/[slug]/keys` family (+ the reveal
 * sibling). Uses the repo's useEffect+fetch convention (no React Query).
 */
export function useWorkspaceKey(workspaceSlug: string): WorkspaceKeyState {
  const [active, setActive] = useState<{ id: string; prefix: string } | null>(null);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/keys`;

  const reveal = useCallback(
    async (id: string): Promise<string | null> => {
      try {
        const res = await fetch(`${base}/${id}/reveal`);
        if (!res.ok) return null; // legacy non-revealable key → 404
        const data = (await res.json()) as { key?: string };
        return data.key ?? null;
      } catch {
        return null;
      }
    },
    [base]
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(base);
      if (!res.ok) {
        setActive(null);
        setPlaintext(null);
        return;
      }
      const data = (await res.json()) as { keys?: ApiKeyRow[] };
      const activeRow = (data.keys ?? []).find((k) => !k.revoked_at) ?? null;
      if (!activeRow) {
        setActive(null);
        setPlaintext(null);
        return;
      }
      setActive({ id: activeRow.id, prefix: activeRow.key_prefix });
      setPlaintext(await reveal(activeRow.id));
    } catch {
      setActive(null);
      setPlaintext(null);
    } finally {
      setIsLoading(false);
    }
  }, [base, reveal]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = useCallback(async () => {
    if (active) {
      setError("Revoke the existing key first.");
      return;
    }
    setError(null);
    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.status === 409) {
      setError("Revoke the existing key first.");
      await load();
      return;
    }
    if (!res.ok) {
      setError("Couldn't generate a key. Try again.");
      return;
    }
    const data = (await res.json()) as {
      key: string;
      id: string;
      prefix: string;
    };
    setActive({ id: data.id, prefix: data.prefix });
    setPlaintext(data.key);
  }, [active, base, load]);

  const revoke = useCallback(async () => {
    if (!active) return;
    setError(null);
    const res = await fetch(`${base}/${active.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Couldn't revoke the key. Try again.");
      return;
    }
    setActive(null);
    setPlaintext(null);
  }, [active, base]);

  const clearError = useCallback(() => setError(null), []);

  return { active, plaintext, isLoading, generate, revoke, error, clearError };
}
