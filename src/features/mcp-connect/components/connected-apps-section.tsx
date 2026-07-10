"use client";

/**
 * ConnectedAppsSection — lists the user's active MCP OAuth grants (apps
 * connected via "Connect → log in") with a Disconnect (revoke) action,
 * framed in the standard section box. Backed by /api/oauth/grants.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/shared/ui/toast";
import { SECTION_BOX_INSET } from "@/shared/ui/section-box";
import { cn } from "@/shared/lib/utils";
import { useApiQuery } from "@/shared/hooks/use-api-query";

interface Grant {
  id: string;
  client_name: string | null;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
}

const GRANTS_PATH = "/api/oauth/grants";
const selectGrants = (body: { grants?: Grant[] }) => body.grants ?? [];

export function ConnectedAppsSection() {
  const queryClient = useQueryClient();
  const query = useApiQuery(GRANTS_PATH, { select: selectGrants });
  // Errors degrade to "no connected apps", matching the old behavior.
  const grants = query.isError ? [] : (query.data ?? null);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function revoke(id: string) {
    setRevoking(id);
    try {
      const res = await fetch(`/api/oauth/grants/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      queryClient.setQueryData(
        [GRANTS_PATH, undefined, undefined],
        (prev: { grants?: Grant[] } | undefined) =>
          prev ? { grants: (prev.grants ?? []).filter((x) => x.id !== id) } : prev
      );
      toast({ title: "Disconnected" });
    } catch {
      toast({ title: "Couldn't disconnect" });
    } finally {
      setRevoking(null);
    }
  }

  let body: React.ReactNode;
  if (grants === null) {
    body = <p className="text-caption font-mono text-text-muted">Loading…</p>;
  } else if (grants.length === 0) {
    body = (
      <p className="text-caption leading-relaxed text-text-muted">
        No connected apps yet. When you connect an MCP client via
        &ldquo;Connect &amp; log in,&rdquo; it appears here and you can revoke it
        anytime.
      </p>
    );
  } else {
    body = (
      <ul className="space-y-1.5">
        {grants.map((g) => (
        <li
          key={g.id}
          className="flex items-center gap-3 rounded-lg border border-border-default bg-bg-elevated px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-body text-text-primary">
              {g.client_name || "MCP client"}
            </p>
            <p className="truncate text-micro font-mono text-text-muted">
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
            className="shrink-0 text-caption text-text-secondary transition-colors hover:text-danger disabled:opacity-50"
          >
            {revoking === g.id ? "…" : "Disconnect"}
          </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="w-full overflow-hidden rounded-[14px] border border-border-strong">
      <div className="flex items-center bg-card-surface-subtle px-4 py-1.5">
        <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
          Connected apps
        </span>
      </div>
      <div className={cn(SECTION_BOX_INSET, "p-4")}>{body}</div>
    </section>
  );
}
