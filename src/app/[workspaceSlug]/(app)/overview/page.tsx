/**
 * /[workspaceSlug]/overview — workspace overview / home page.
 *
 * Workspace-at-a-glance (live counts that double as navigation), agent
 * connection status, per-client MCP setup with official-docs links, and
 * the copy-pastable Dopl SKILL.md. Rendered in the AppShell's white
 * panel (light design language — matches the members/knowledge pages).
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { workspaceSegment } from "@/features/workspaces/url";
import { isMcpConnected } from "@/features/onboarding/server/service";
import { AppPanel } from "@/shared/layout/app-shell";
import { PageTopBar } from "@/shared/layout/page-top-bar";
import { AgentSkillCard, ConnectClients } from "@/features/mcp-connect";
import { OverviewStats } from "@/features/workspaces/components/overview-stats";
import { MembersWidget } from "@/features/members/components/members-widget";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

/** Parallel head-counts for the stat cards. Failures degrade to 0. */
async function loadCounts(workspaceId: string) {
  const db = supabaseAdmin();
  const count = (table: string, soft: boolean) => {
    let q = db
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);
    if (soft) q = q.is("deleted_at", null);
    return q;
  };
  const [wf, kb, sk, mem] = await Promise.all([
    count("workflows", false),
    count("knowledge_bases", true),
    count("skills", true),
    db
      .from("workspace_members")
      .select("user_id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
  ]);
  return {
    workflows: wf.count ?? 0,
    knowledgeBases: kb.count ?? 0,
    skills: sk.count ?? 0,
    members: mem.count ?? 0,
  };
}

export default async function OverviewPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await resolvePageWorkspace(workspaceSlug, user.id, "overview");
  const segment = workspaceSegment(workspace);

  const [counts, connected] = await Promise.all([
    loadCounts(workspace.id),
    isMcpConnected(user.id).catch(() => false),
  ]);

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
          <OverviewStats segment={segment} {...counts} />

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
                tools, the conventions, and how to follow workflow stages.
              </p>
            </div>
            <AgentSkillCard />
          </section>

          {/* ── Members ────────────────────────────────────────────── */}
          <MembersWidget workspaceSlug={segment} />
        </div>
      </div>
    </AppPanel>
  );
}
