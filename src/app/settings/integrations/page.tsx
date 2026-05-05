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
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
            <IntegrationsManager />
          </div>
        </div>
      </div>
    </>
  );
}
