/**
 * `/billing` — segment-less entry. Exists for callers holding no workspace segment: the 402/403
 * `upgrade_url` envelopes (MCP agents follow them literally) and the public `/pricing` page.
 *
 * 🔒 **IT RESOLVES, OR IT ASKS — IT NEVER GUESSES (Samuel's ruling B10).** This used to forward to
 * whichever workspace a derived lookup called "the default", so an account with two of them had a
 * payment page for the oldest and no way to tell. There is no such derivation left: a caller who
 * owns exactly ONE standard workspace is forwarded, unchanged and query-intact, and everyone else
 * is shown their own list and picks.
 *
 * ⚠ **`?plan=pro` IS A NAMED DESTINATION, NOT A GUESS (2026-09-08, spec §11).** Pro is sold on the
 * caller's `kind='personal'` container and on nothing else, so a request that names it has already
 * named its container — there is exactly one per user. The forward is therefore as determined as a
 * segment in the URL would be, and it exists because no SELLER holds that segment: a 402 envelope,
 * the desktop and `/pricing` all know the plan and not the container. ⚠ It runs BEFORE the
 * sole-owned-workspace forward, or a one-workspace user asking for Pro would land on their
 * workspace's billing page and be refused by the checkout route.
 *
 * 🔒 **AND A CALLER WITH NO STANDARD WORKSPACE IS FORWARDED TO IT (2026-09-10, the new-user flow),
 * with or without `?plan=`.** A home-only account has exactly one page it could pick, so the picker
 * was a question with one answer — and the caller this page exists for is an MCP agent following a
 * 402 `upgrade_url` literally, which for an intent-only envelope carries no `?plan=` to forward on.
 * This is not the guess ruling B10 deleted: that one chose among SEVERAL candidates by age, this one
 * is the only candidate there is.
 *
 * ⚠ **THE PERSONAL CONTAINER IS STILL A PICKER ROW FOR EVERYONE ELSE, AND STILL NOT A `choices`
 * CANDIDATE.** It carries a plan of its own since §11 (`free` / `pro`), so hiding it hid a page the
 * caller may pay on; it is rendered as its own row, above the workspaces, rather than being folded
 * into a list whose every other entry is a standard workspace with a seat count. Link containers
 * stay out — those carry no plan at all. Since the forward above, the row is only ever reached by a
 * caller who ALSO has standard workspaces.
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
import { billingSelfPath, parseCheckoutPlan } from "@/features/billing/url";
import { findSoleOwnedStandardWorkspace } from "@/features/workspaces/server/repository";
import { listMyWorkspacesWithRole } from "@/features/workspaces/server/service";
import { isStandardWorkspace } from "@/features/workspaces/types";
import { workspaceSegment } from "@/features/workspaces/url";
import { getUser } from "@/shared/supabase/server";

export const metadata = {
  title: "Billing — Dopl",
  description: "Choose the space whose plan you want to manage.",
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

  // ⚠ ONE membership read serves both the Pro forward and the picker's Personal
  // row. The personal container is a membership like any other (its owner is its
  // only member), so no second lookup is needed to find it.
  const memberships = await listMyWorkspacesWithRole(user.id);
  const personal = memberships.find((w) => w.kind === "personal") ?? null;

  // ⚠ Pro names its container, so this forward is a resolution, not a guess.
  // A caller with no personal container yet (nothing has minted one) falls
  // through to the picker rather than 404ing on a segment that does not exist.
  if (
    parseCheckoutPlan(typeof query.plan === "string" ? query.plan : null) ===
      "pro" &&
    personal
  ) {
    redirect(billingSelfPath(workspaceSegment(personal), query));
  }

  const { workspace } = await findSoleOwnedStandardWorkspace(user.id);
  if (workspace) {
    redirect(billingSelfPath(workspaceSegment(workspace), query));
  }

  const choices = memberships.filter(isStandardWorkspace);

  // 🔒 **THE HOME-ONLY CALLER IS FORWARDED, NOT ASKED (2026-09-10, the new-user
  // flow).** With no standard workspace there is exactly ONE page they could
  // pick — their own home space — so the picker was a question with one answer
  // under a heading that asked it ("Which space?"). ⚠ **AND IT WAS WORSE THAN
  // redundant for the caller this exists for:** a 402 `upgrade_url` with no
  // `?plan=` (the intent-only envelopes) lands here, so an agent following the
  // link literally ended on a chooser instead of the plan it was refused by.
  // ⚠ **THIS IS NOT THE GUESS RULING B10 DELETED.** That forward picked one of
  // SEVERAL candidates by age; this one is the only candidate there is — the same
  // argument `?plan=pro` above stands on, arrived at from the other side.
  if (choices.length === 0 && personal) {
    redirect(billingSelfPath(workspaceSegment(personal), query));
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-4 p-6">
      <h1 className="text-title font-medium text-text-primary">Which space?</h1>
      <p className="text-body text-text-secondary">
        {choices.length === 0 && !personal
          ? "Billing belongs to a space, and you are not in one yet. Create a workspace in the Dopl app, then come back."
          : "Pick the space whose plan you want to manage."}
      </p>
      {personal && (
        <ul className="flex flex-col gap-1">
          <li>
            <Link
              href={billingSelfPath(workspaceSegment(personal), query)}
              className="flex items-center justify-between rounded-lg px-3 py-2.5 text-body text-text-primary hover:bg-surface-raised-2"
            >
              <span>{personal.name}</span>
              <span className="text-caption text-text-secondary">
                Your personal space
              </span>
            </Link>
          </li>
        </ul>
      )}
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
