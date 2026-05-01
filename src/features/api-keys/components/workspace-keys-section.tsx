"use client";

/**
 * Workspace-scoped API key management — used by both the workspace
 * settings page and the workspace overview page (Item 5.B).
 *
 * Mirrors the user-key flow at /settings/keys, but bound to one
 * workspace. Admins create + revoke; viewers/editors see the list.
 */

import { useEffect, useState } from "react";
import { Copy, Key as KeyIcon, Plus, Trash2 } from "lucide-react";
import { toast } from "@/shared/ui/toast";

interface ApiKey {
  id: string;
  key_prefix: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface Props {
  workspaceSlug: string;
  /** When false, hide the "Create" button. Use viewer-role check from caller. */
  canCreate?: boolean;
}

export function WorkspaceKeysSection({ workspaceSlug, canCreate = true }: Props) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/workspaces/${workspaceSlug}/keys`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((body: { keys: ApiKey[] }) => {
        if (!cancelled) {
          setKeys(body.keys.filter((k) => !k.revoked_at));
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load API keys");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, tick]);

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error?.message ?? body?.error ?? "Create failed");
      }
      setNewKey(body.key as string);
      setNewName("");
      setTick((t) => t + 1);
    } catch (err) {
      toast({
        title: "Couldn't create key",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string, label: string) {
    if (!window.confirm(`Revoke "${label}"? Active connections using this key will start failing immediately.`)) return;
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/keys/${id}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? "Revoke failed");
      }
      setTick((t) => t + 1);
      toast({ title: `Revoked "${label}"` });
    } catch (err) {
      toast({
        title: "Couldn't revoke key",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return (
    <section className="rounded-xl border border-white/[0.06] p-5 bg-white/[0.02]">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-medium text-text-primary flex items-center gap-2">
            <KeyIcon size={13} />
            API keys
          </p>
          <p className="mt-0.5 text-xs text-text-secondary">
            Workspace-scoped keys for connecting your agent (Claude Code,
            CLI, MCP). Locked to this workspace — keys can&rsquo;t be reused
            across workspaces.
          </p>
        </div>
      </div>

      {newKey ? (
        <div className="mb-3 rounded-lg border border-violet-400/40 bg-violet-500/[0.06] p-3">
          <p className="text-xs font-medium text-text-primary mb-1.5">
            New key — copy now, it won&rsquo;t be shown again
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-[11px] text-text-primary bg-black/40 px-2 py-1.5 rounded truncate">
              {newKey}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(newKey).catch(() => {});
                toast({ title: "Copied to clipboard" });
              }}
              className="shrink-0 h-7 px-2.5 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 transition-colors flex items-center gap-1"
            >
              <Copy size={11} />
              Copy
            </button>
            <button
              type="button"
              onClick={() => setNewKey(null)}
              className="shrink-0 text-xs text-text-secondary hover:text-text-primary px-2"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}

      {canCreate ? (
        <div className="flex items-center gap-2 mb-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Claude Code on laptop"
            className="flex-1 h-8 px-3 rounded-md bg-white/[0.06] border border-white/[0.12] text-sm text-text-primary placeholder:text-text-secondary/50 outline-none focus:border-white/[0.25]"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="shrink-0 h-8 px-3 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            <Plus size={11} />
            {creating ? "Creating…" : "Generate"}
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="text-xs text-text-secondary">Loading…</p>
      ) : error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : keys.length === 0 ? (
        <p className="text-xs text-text-secondary">No keys yet.</p>
      ) : (
        <div className="rounded-md border border-white/[0.06] divide-y divide-white/[0.04]">
          {keys.map((k) => (
            <div key={k.id} className="flex items-center gap-3 px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary truncate">{k.name}</p>
                <p className="text-[11px] font-mono text-text-secondary/70">
                  {k.key_prefix}…
                  {k.last_used_at
                    ? ` · last used ${formatRelative(k.last_used_at)}`
                    : " · never used"}
                </p>
              </div>
              {canCreate ? (
                <button
                  type="button"
                  onClick={() => handleRevoke(k.id, k.name)}
                  className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-xs text-red-400 hover:bg-red-500/[0.08] cursor-pointer"
                >
                  <Trash2 size={11} />
                  Revoke
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = 60_000;
  const h = 60 * m;
  const d = 24 * h;
  if (diff < m) return "just now";
  if (diff < h) return `${Math.floor(diff / m)}m ago`;
  if (diff < d) return `${Math.floor(diff / h)}h ago`;
  if (diff < 7 * d) return `${Math.floor(diff / d)}d ago`;
  return new Date(iso).toLocaleDateString();
}
