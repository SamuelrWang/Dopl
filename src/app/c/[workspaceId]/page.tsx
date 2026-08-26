/**
 * `/c/{containerId}` — THE GUEST LANE (spec: `docs/specs/guest-web-channel.md`).
 * One channel in a browser for a person with no desktop app: they claim a link,
 * land here, and talk to the operator's agent. Not a web version of the app —
 * there is no rail, no sidebar, no workspace surface and no settings, and this
 * route reaches exactly ONE container.
 *
 * ⚠ THE SEGMENT IS THE RAW CONTAINER UUID, not the `{slug}-{publicId}` segment
 * every other workspace URL uses. The claim response already carries
 * `channel.workspaceId`, `X-Workspace-Id` is UUID-only, and `findMemberContainer`
 * takes the UUID — a slug round trip would buy nothing here, and this URL is a
 * post-claim destination rather than a link anybody shares.
 *
 * ⚠ AUTH-REQUIRED TWICE, exactly as `/billing/{segment}` is. `/c` is absent from
 * `shared/auth/public-routes.ts › PUBLIC_ROUTES` — auth-gated BY OMISSION, which
 * is the deliberate posture — and the `getUser()` below is the second lock,
 * because the middleware decides from LOCALLY verified claims and this from
 * GoTrue. The stricter wins.
 *
 * ⚠ THE ORDER OF THE THREE GATES IS THE CONTRACT:
 *   1. auth, BEFORE anything is looked up — a signed-out visitor learns nothing
 *      about the id in their URL, not even whether it is well-formed;
 *   2. the UUID guard, so garbage never reaches the service (and never becomes a
 *      malformed-uuid database error masquerading as a 500);
 *   3. `getHomeChannel`, whose `null` is the home fence idiom — "not a container",
 *      "not a link container" and "not a member" all render the SAME `notFound()`,
 *      so the URL is not an existence oracle for container ids.
 */

import { notFound, redirect } from "next/navigation";
import { getHomeChannel } from "@/features/home/server/service-reads";
import { isUuid } from "@/shared/lib/id/uuid";
import { getUser } from "@/shared/supabase/server";
import { GuestChannel } from "./guest-channel";

export const metadata = {
  title: "Channel — Dopl",
  description: "Your conversation on Dopl.",
};

/** Per-request facts: membership and the channel row both change under a cache. */
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceId: string }>;
}

export default async function GuestChannelPage({ params }: PageProps) {
  const { workspaceId } = await params;

  const user = await getUser();
  if (!user) {
    redirect(`/login?redirectTo=${encodeURIComponent(`/c/${workspaceId}`)}`);
  }

  if (!isUuid(workspaceId)) notFound();

  const homeChannel = await getHomeChannel(user.id, workspaceId);
  if (!homeChannel) notFound();

  return <GuestChannel homeChannel={homeChannel} currentUserId={user.id} />;
}
