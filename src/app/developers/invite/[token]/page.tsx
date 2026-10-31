import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { ROLE_LABEL } from "@/features/device-sdk/portal/scope";
import { getInviteForToken } from "@/features/device-sdk/server/portal-invites";
import { AcceptInvite } from "./accept-invite";

/**
 * `/developers/invite/{token}` — accept a developer org invite (P3). Signed-in only: the proxy
 * gates `/developers`, and a signed-out visitor comes back here after signing in or signing up.
 * The token is the secret; the page shows the org, the role and the invited email, and the Accept
 * call re-checks everything server-side (the confirmed email must match).
 * ⚠ The token sits in this URL's PATH, so it can reach access logs; it is single-use, email-bound
 * and expires in 7 days, which is what bounds that, and `referrer: "no-referrer"` keeps it out of
 * any Referer header a link on this page would send.
 */
/** The token is in this path: never send it onward as a Referer. */
export const metadata: Metadata = { referrer: "no-referrer" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getUser();
  if (!user) redirect(`/login?redirectTo=${encodeURIComponent(`/developers/invite/${token}`)}`);
  const invite = await getInviteForToken(token);

  const state = !invite
    ? ({ kind: "missing" } as const)
    : invite.state === "accepted" && invite.acceptedBy === user.id
      ? ({ kind: "joined", orgId: invite.orgId } as const)
      : invite.state !== "open"
        ? ({ kind: invite.state } as const)
        : (user.email ?? "").trim().toLowerCase() !== invite.email
          ? ({ kind: "mismatch", invited: invite.email, signedIn: user.email ?? "this account" } as const)
          : ({ kind: "open" } as const);

  return <AcceptInvite token={token} orgName={invite?.orgName ?? null} role={invite ? ROLE_LABEL[invite.role] : null} state={state} />;
}
