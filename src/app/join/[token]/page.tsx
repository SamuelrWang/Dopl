/**
 * /join/[token] — shareable join-link landing page.
 *
 * Server-fetches the public link info (workspace + inviter context), then
 * renders a card. Unauthenticated visitors see who invited them and a
 * sign-in CTA that bounces through /login and back here; authenticated
 * visitors get a "Request to join" button that files an admin-approval
 * join request.
 */

import { notFound } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { getJoinLinkInfo } from "@/features/workspaces/server/join-links";
import { JoinLinkCard } from "@/features/workspaces/components/join-link-card";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function JoinLinkPage({ params }: PageProps) {
  const { token } = await params;
  if (!token) notFound();

  const info = await getJoinLinkInfo(token);
  if (!info) notFound();

  const user = await getUser();

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-24">
      <JoinLinkCard
        workspaceName={info.workspaceName}
        inviterName={info.inviterName}
        inviterEmail={info.inviterEmail}
        token={token}
        needsAuth={!user}
      />
    </main>
  );
}
