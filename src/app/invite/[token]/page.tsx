/**
 * /invite/[token] — accept-invite landing. Server-fetches the public invitation status by token.
 * Auth-gated only at the ACCEPT step: the status endpoint needs no session, so unauthed visitors
 * see what they are being invited to before signing in.
 */

import { notFound } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { getInvitationByToken } from "@/features/workspaces/server/invitations";
import { AcceptInviteCard } from "@/features/workspaces/components/accept-invite-card";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function AcceptInvitePage({ params }: PageProps) {
  const { token } = await params;
  if (!token) notFound();

  const status = await getInvitationByToken(token);
  if (!status) notFound();

  const user = await getUser();

  // Strip the token from client props — it is already in the URL.
  const { token: _omit, ...invitationWithoutToken } = status.invitation;
  void _omit;
  const safeStatus = {
    ...status,
    invitation: invitationWithoutToken,
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-24">
      <AcceptInviteCard status={safeStatus} token={token} needsAuth={!user} />
    </main>
  );
}
