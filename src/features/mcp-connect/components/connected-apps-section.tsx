"use client";

/**
 * ConnectedAppsSection — lists the user's active MCP OAuth grants (apps
 * connected via "Connect → log in") with a Disconnect (revoke) action.
 * Backed by /api/oauth/grants.
 */

import { useEffect, useState } from "react";
import { toast } from "@/shared/ui/toast";

interface Grant {
  id: string;
  client_name: string | null;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
}

export function ConnectedAppsSection() {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/oauth/grants");
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { grants?: Grant[] };
        if (!cancelled) setGrants(data.grants ?? []);
      } catch {
        if (!cancelled) setGrants([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function revoke(id: string) {
    setRevoking(id);
    try {
      const res = await fetch(`/api/oauth/grants/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setGrants((g) => (g ? g.filter((x) => x.id !== id) : g));
      toast({ title: "Disconnected" });
    } catch {
      toast({ title: "Couldn't disconnect" });
    } finally {
      setRevoking(null);
    }
  }

  if (grants === null) {
    return <p className="text-[11px] text-text-muted font-mono">Loading…</p>;
  }
  if (grants.length === 0) {
    return (
      <p className="text-[11px] text-text-muted leading-relaxed">
        No connected apps yet. When you connect an MCP client via
        &ldquo;Connect &amp; log in,&rdquo; it appears here and you can revoke it
        anytime.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {grants.map((g) => (
        <li
          key={g.id}
          className="flex items-center gap-3 rounded-[3px] border border-border-default bg-surface-raised-1 px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-text-primary truncate">
              {g.client_name || "MCP client"}
            </p>
            <p className="text-[10px] text-text-muted font-mono truncate">
              {g.scopes.join(" ") || "dopl.read"}
              {g.last_used_at
                ? ` · last used ${new Date(g.last_used_at).toLocaleDateString()}`
                : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void revoke(g.id)}
            disabled={revoking === g.id}
            className="shrink-0 text-[11px] text-text-tertiary hover:text-red-400/90 transition-colors disabled:opacity-50"
          >
            {revoking === g.id ? "…" : "Disconnect"}
          </button>
        </li>
      ))}
    </ul>
  );
}
