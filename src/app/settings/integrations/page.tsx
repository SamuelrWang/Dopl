import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/shared/supabase/server";
import { PageTopBar } from "@/shared/layout/page-top-bar";
import { IntegrationsManager } from "@/features/integrations/components/integrations-manager";

export const dynamic = "force-dynamic";

/**
 * /settings/integrations
 *
 * Full-bleed page that mirrors the workspace-level surfaces (members,
 * chat, knowledge detail). Even though integrations live in user
 * settings, the content (a row-per-account table with per-row actions
 * and a workspace-grant picker) reads like a workspace data table —
 * matching members' shell keeps the visual grammar consistent.
 *
 * The full-bleed branch is opted in via LayoutShell's `isFullBleed`
 * regex (see src/shared/layout/layout-shell.tsx).
 */
export default async function IntegrationsSettingsPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  return (
    <>
      <PageTopBar
        title="Integrations"
        trailing={
          <Link
            href="/settings"
            className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-white/[0.08] hover:bg-white/[0.04] transition-colors text-xs text-text-secondary hover:text-text-primary"
          >
            ← Settings
          </Link>
        }
      />

      <div className="fixed top-[52px] right-0 bottom-0 left-0 md:left-64 z-[3] p-3 pointer-events-auto">
        <div
          className="h-full rounded-2xl border border-white/[0.1] overflow-hidden flex flex-col"
          style={{ backgroundColor: "oklch(0.13 0 0)" }}
        >
          <header className="px-6 pt-5 pb-4 border-b border-white/[0.06]">
            <p className="text-sm text-text-secondary leading-relaxed max-w-prose">
              Connect a third-party service so your agent can read or write
              on your behalf — Gmail, Notion, Slack, and more.
            </p>
          </header>

          <section className="px-6 py-4 border-b border-white/[0.06] text-xs text-text-secondary leading-relaxed space-y-2 max-w-prose">
            <p>
              <span className="text-text-primary font-medium">How this works.</span>{" "}
              We use{" "}
              <a
                href="https://composio.dev"
                target="_blank"
                rel="noreferrer"
                className="text-text-primary underline decoration-white/20 hover:decoration-white/60"
              >
                Composio
              </a>{" "}
              as our OAuth broker — they hold the access tokens, we never see them.
              Each Composio auth config points at our own OAuth apps with each
              provider, so consent screens say &quot;Dopl,&quot; not &quot;Composio.&quot;
            </p>
            <p>
              <span className="text-text-primary font-medium">Scoping.</span>{" "}
              Connections are tied to <em>you</em>, not a workspace. A teammate
              in the same workspace can&apos;t see or use your accounts. By
              default, each connection is granted to every workspace you belong
              to — uncheck specific workspaces below to scope tighter.
            </p>
            <p>
              <span className="text-text-primary font-medium">Multiple accounts.</span>{" "}
              You can connect more than one account per provider (e.g. work
              Gmail + personal Gmail). The agent picks the right one based on
              the workspace context.
            </p>
          </section>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
            <IntegrationsManager />
          </div>
        </div>
      </div>
    </>
  );
}
