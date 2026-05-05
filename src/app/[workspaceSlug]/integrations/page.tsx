import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/shared/supabase/server";
import { resolveMembershipOrThrow } from "@/features/workspaces/server/service";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { listIntegrationsForUser } from "@/features/integrations/server/service";
import {
  INTEGRATION_PROVIDERS,
  PROVIDER_DISPLAY_NAMES,
} from "@/features/integrations/constants";
import type { IntegrationProvider, OAuthConnection } from "@/features/integrations/types";
import { DisconnectButton } from "@/features/integrations/components/disconnect-button";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

const STATUS_COPY: Record<OAuthConnection["status"] | "disconnected", string> = {
  connected: "Connected",
  needs_auth: "Authorization in progress",
  error: "Error — try reconnecting",
  disconnected: "Not connected",
};

const STATUS_DOT: Record<OAuthConnection["status"] | "disconnected", string> = {
  connected: "bg-emerald-400",
  needs_auth: "bg-amber-400",
  error: "bg-red-400",
  disconnected: "bg-white/30",
};

export default async function IntegrationsPage({ params }: PageProps) {
  const { workspaceSlug } = await params;

  const user = await getUser();
  if (!user) redirect("/login");

  const workspace = await resolvePageWorkspace(workspaceSlug, user.id, "integrations");
  await resolveMembershipOrThrow(workspace.id, user.id);

  const connections = await listIntegrationsForUser({
    workspaceId: workspace.id,
    userId: user.id,
  });
  const byProvider = new Map(connections.map((c) => [c.provider, c]));

  return (
    <div className="container mx-auto px-4 pt-24 pb-16 max-w-2xl">
      <Link
        href="/workspaces"
        className="text-[10px] uppercase tracking-wider text-white/40 hover:text-white/70 transition-colors"
      >
        ← All workspaces
      </Link>
      <div className="mt-3 mb-8">
        <h1 className="text-2xl font-semibold text-white">Integrations</h1>
        <p className="mt-2 text-sm text-white/60 max-w-prose">
          Connect a third-party service to let your agent pull content
          straight into this workspace. We never store the underlying
          access tokens — they live with the OAuth broker.
        </p>
      </div>

      <ul className="space-y-3">
        {INTEGRATION_PROVIDERS.map((provider) => {
          const conn = byProvider.get(provider);
          const status = conn?.status ?? "disconnected";
          const label = PROVIDER_DISPLAY_NAMES[provider as IntegrationProvider];
          return (
            <li
              key={provider}
              className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status]}`}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{label}</p>
                  <p className="text-xs text-white/50">{STATUS_COPY[status]}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {status === "connected" ? (
                  <DisconnectButton
                    provider={provider}
                    workspaceId={workspace.id}
                    providerLabel={label}
                  />
                ) : (
                  <Link
                    href={`/connect/${provider}/start`}
                    className="rounded-md border border-white/10 bg-white text-black px-3 py-1.5 text-xs font-medium hover:bg-white/90"
                  >
                    {status === "needs_auth" ? "Resume" : "Connect"}
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-8 text-xs text-white/40">
        Your agent can also drive these flows via the{" "}
        <code className="font-mono text-white/60">connect_integration</code>,{" "}
        <code className="font-mono text-white/60">read_integration_object</code>,
        and{" "}
        <code className="font-mono text-white/60">ingest_from_integration</code>{" "}
        MCP tools.
      </p>
    </div>
  );
}
