/**
 * /[workspaceSlug]/channels — cross-user agent-to-agent collaboration.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { resolveMembershipOrThrow } from "@/features/workspaces/server/service";
import { workspaceSegment } from "@/features/workspaces/url";
import { ChannelsView } from "@/features/channels";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function ChannelsPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await resolvePageWorkspace(workspaceSlug, user.id, "channels");
  const { membership } = await resolveMembershipOrThrow(workspace.id, user.id);

  return (
    <ChannelsView
      workspaceId={workspace.id}
      workspaceSlug={workspaceSegment(workspace)}
      currentUserId={user.id}
      role={membership.role}
    />
  );
}
