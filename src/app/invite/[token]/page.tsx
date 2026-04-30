/**
 * /invite/[token] — accept-invite landing page.
 *
 * Server-fetches the public invitation status by token, then renders a
 * card with canvas/inviter context. Auth-gated only at the accept step:
 * the public-status endpoint doesn't require a session, so unauthed
 * visitors see what they're being invited to before signing in.
 */

import { notFound } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { getInvitationByToken } from "@/features/canvases/server/invitations";
import { AcceptInviteCard } from "@/features/canvases/components/accept-invite-card";

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

  // Strip the token from the props passed to the client — it's already
  // in the URL; the API endpoint doesn't echo it either.
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
