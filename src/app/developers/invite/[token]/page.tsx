import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { ROLE_LABEL } from "@/features/device-sdk/portal/scope";
import { getInviteForToken } from "@/features/device-sdk/server/portal-invites";
import { AcceptInvite } from "./accept-invite";

/**
 * Accepts a developer org invite, signed in only; a signed-out visitor comes back here after signing in.
 * The Accept call re-checks everything server-side (the confirmed email must match).
 * ⚠ The token sits in this URL's PATH, so it can reach access logs. Being single-use, email-bound and
 * expiring in 7 days is what bounds that, and `no-referrer` keeps it out of any Referer header.
 */
export const metadata: Metadata = { referrer: "no-referrer" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getUser();
  if (!user) redirect(`/login?redirectTo=${encodeURIComponent(`/developers/invite/${token}`)}`);
  const invite = await getInviteForToken(token);

  const state = !invite
    ? ({ kind: "missing" } as const)
    : invite.state === "accepted" && invite.acceptedBy === user.id
      ? ({ kind: "joined" } as const)
      : invite.state !== "open"
        ? ({ kind: invite.state } as const)
        : (user.email ?? "").trim().toLowerCase() !== invite.email
          ? ({ kind: "mismatch", invited: invite.email, signedIn: user.email ?? "this account" } as const)
          : ({ kind: "open" } as const);

  return <AcceptInvite token={token} orgName={invite?.orgName ?? null} role={invite ? ROLE_LABEL[invite.role] : null} state={state} />;
}
