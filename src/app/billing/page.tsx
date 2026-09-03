/**
 * `/billing` — segment-less entry. Exists for callers holding no workspace segment: the 402/403
 * `upgrade_url` envelopes (MCP agents follow them literally) and the public `/pricing` page.
 *
 * 🔒 **IT RESOLVES, OR IT ASKS — IT NEVER GUESSES (Samuel's ruling B10).** This used to forward to
 * whichever workspace a derived lookup called "the default", so an account with two of them had a
 * payment page for the oldest and no way to tell. There is no such derivation left: a caller who
 * owns exactly ONE standard workspace is forwarded, unchanged and query-intact, and everyone else
 * is shown their own list and picks. ⚠ A personal container is not a candidate and is not listed —
 * it carries no plan (`@dopl/contracts › WorkspaceKind`), which is the same reason the rail omits it.
 *
 * ⚠ THE LIST IS MEMBERSHIPS, THE FORWARD IS OWNERSHIP, and the asymmetry is deliberate: only an
 * owner has a bill that can be resolved FOR them, but an admin of somebody else's workspace can
 * still open its billing page, so refusing to list it would hide a page they may use.
 *
 * ⚠ NO ONBOARDING DETOUR: somebody arriving here is trying to pay, and a first-run survey in
 * front of that is an abandoned checkout.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { billingSelfPath } from "@/features/billing/url";
import { findSoleOwnedStandardWorkspace } from "@/features/workspaces/server/repository";
import { listMyWorkspacesWithRole } from "@/features/workspaces/server/service";
import { isStandardWorkspace } from "@/features/workspaces/types";
import { workspaceSegment } from "@/features/workspaces/url";
import { getUser } from "@/shared/supabase/server";

export const metadata = {
  title: "Billing — Dopl",
  description: "Choose the workspace whose plan you want to manage.",
};

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function BillingWorkspacePickerPage({
  searchParams,
}: PageProps) {
  const query = await searchParams;

  const user = await getUser();
  // ⚠ Query-preserving: `?billing=upgrade` must survive the sign-in round trip.
  if (!user) {
    redirect(
      `/login?redirectTo=${encodeURIComponent(billingSelfPath(null, query))}`
    );
  }

  const { workspace } = await findSoleOwnedStandardWorkspace(user.id);
  if (workspace) {
    redirect(billingSelfPath(workspaceSegment(workspace), query));
  }

  const choices = (await listMyWorkspacesWithRole(user.id)).filter(
    isStandardWorkspace
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-4 p-6">
      <h1 className="text-title font-medium text-text-primary">
        Which workspace?
      </h1>
      <p className="text-body text-text-secondary">
        {choices.length === 0
          ? "Billing belongs to a workspace, and you are not in one yet. Create one in the Dopl app, then come back."
          : "A plan belongs to a workspace. Pick the one you want to manage."}
      </p>
      {choices.length > 0 && (
        <ul className="flex flex-col gap-1">
          {choices.map((choice) => (
            <li key={choice.id}>
              <Link
                href={billingSelfPath(workspaceSegment(choice), query)}
                className="flex items-center justify-between rounded-lg px-3 py-2.5 text-body text-text-primary hover:bg-surface-raised-2"
              >
                <span>{choice.name}</span>
                <span className="text-caption text-text-secondary">
                  {choice.role}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
