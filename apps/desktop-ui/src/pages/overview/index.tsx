import { AppPanel } from "@/shared/layout/app-shell/app-panel";
import { PageTopBar } from "@/shared/layout/page-top-bar";
import { ConnectClients } from "@/features/mcp-connect/components/connect-clients";
import { AgentSkillCard } from "@/features/mcp-connect/components/agent-skill-card";
import { OverviewStatsCore } from "@/features/workspaces/components/overview-stats-core";
import { MembersWidgetCore } from "@/features/members/components/members-widget-core";
import type { WorkspaceMemberView } from "@/features/members/types";
import type { WorkspaceOverviewCounts } from "@/features/workspaces/types";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, PageLoading } from "#/components/page-states";
import { RouterLink, useWorkspaceRoute } from "#/components/app-shell";

/**
 * /:workspaceSegment/overview — workspace overview / home page. Port of
 * `src/app/[workspaceSlug]/(app)/overview/page.tsx` (docs/migration-research/
 * web-pages.md §4).
 *
 * The RSC's four `supabaseAdmin()` head-counts + `isMcpConnected` are one
 * client read here: `GET /api/workspaces/{segment}/overview-counts`. The stat
 * row and the members panel are the web app's own components, imported through
 * `@/` as their Next-free cores with the SPA's router and transport injected;
 * `ConnectClients` / `AgentSkillCard` are reused verbatim (they never fetch).
 */

/**
 * `GET /api/workspaces/[workspaceSlug]/overview-counts`. Still carries
 * `workflows` — the route and the table are untouched by the retirement
 * (docs/RETIREMENT-UNWIRING-PLAN.md §3.1); the stat row simply stopped
 * rendering a card for it, because there is no longer a page to link to.
 */
interface OverviewCountsBody extends WorkspaceOverviewCounts {
  isMcpConnected: boolean;
}

const ZERO_COUNTS: OverviewCountsBody = {
  workflows: 0,
  knowledgeBases: 0,
  skills: 0,
  members: 0,
  isMcpConnected: false,
};

const selectMembers = (body: { members?: WorkspaceMemberView[] }) =>
  body.members ?? [];

export default function OverviewPage() {
  const { workspace, segment, isPending, error, refetch } = useWorkspaceRoute();

  const countsQuery = useApiQuery<OverviewCountsBody>(
    segment
      ? `/api/workspaces/${encodeURIComponent(segment)}/overview-counts`
      : null
  );
  // Same path + shape the members page reads, so the two share one cache entry.
  const membersQuery = useApiQuery<
    { members?: WorkspaceMemberView[] },
    WorkspaceMemberView[]
  >(segment ? `/api/workspaces/${encodeURIComponent(segment)}/members` : null, {
    select: selectMembers,
  });

  if (isPending) return <PageLoading />;
  if (error || !workspace) {
    return (
      <PageError error={error ?? new Error("Workspace not found")} onRetry={refetch} />
    );
  }

  // Counts degrade to zeros rather than replacing the page with an error — the
  // RSC does the same (`.catch(() => 0)` per count), and the connect-an-agent
  // half of this page is useful without them.
  const counts = countsQuery.data ?? ZERO_COUNTS;
  const connected = counts.isMcpConnected;

  return (
    <AppPanel scroll={false}>
      <PageTopBar title="Overview" />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-6 max-w-4xl mx-auto space-y-6 pb-12">
          {/* ── Workspace header ───────────────────────────────────── */}
          <section className="rounded-xl border border-border-default bg-[var(--card-surface)] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60 mb-1">
                  Workspace
                </p>
                <h1 className="text-xl font-semibold text-text-primary">
                  {workspace.name}
                </h1>
                <p className="mt-1 text-xs text-text-secondary font-mono">
                  /{workspace.slug}
                </p>
              </div>
              <span
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
                  connected
                    ? "border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-700"
                    : "border-border-default bg-surface-raised-1 text-text-tertiary"
                }`}
                title={
                  connected
                    ? "An agent has signed in to this account over MCP"
                    : "No agent has connected over MCP yet — set one up below"
                }
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    connected ? "bg-emerald-500" : "bg-text-muted/40"
                  }`}
                />
                {connected ? "Agent connected" : "No agent connected"}
              </span>
            </div>
          </section>

          {/* ── At a glance ────────────────────────────────────────── */}
          <OverviewStatsCore
            segment={segment}
            knowledgeBases={counts.knowledgeBases}
            skills={counts.skills}
            members={counts.members}
            Link={RouterLink}
          />

          {/* ── Connect an agent ───────────────────────────────────── */}
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">
                Connect your agent
              </h2>
              <p className="mt-0.5 text-[12px] text-text-tertiary">
                Add the Dopl MCP server to your coding agent — sign-in is a
                one-time browser OAuth flow, no API keys.
              </p>
            </div>
            <ConnectClients />
          </section>

          {/* ── Agent skill ────────────────────────────────────────── */}
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">
                Make your agent good at Dopl
              </h2>
              <p className="mt-0.5 text-[12px] text-text-tertiary">
                Local skills load when a session boots — this one teaches the
                tools and the conventions.
              </p>
            </div>
            <AgentSkillCard />
          </section>

          {/* ── Members ────────────────────────────────────────────── */}
          <MembersWidgetCore
            workspaceSlug={segment}
            members={membersQuery.data ?? null}
            loading={membersQuery.isPending}
            Link={RouterLink}
          />
        </div>
      </div>
    </AppPanel>
  );
}
