/**
 * /[workspaceSlug]/chats — the agent-exported chat archive.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { resolveMembershipOrThrow } from "@/features/workspaces/server/service";
import { workspaceSegment } from "@/features/workspaces/url";
import {
  buildChatContext,
  listChats,
  listFolders,
} from "@/features/chats/server/service";
import { ChatsView } from "@/features/chats/components/chats-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function ChatsPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await resolvePageWorkspace(workspaceSlug, user.id, "chats");
  const { membership } = await resolveMembershipOrThrow(workspace.id, user.id);

  const ctx = buildChatContext({
    userId: user.id,
    workspaceId: workspace.id,
    role: membership.role,
    agentTokenId: null,
  });
  const [{ chats, hiddenCount }, folders] = await Promise.all([
    listChats(ctx),
    listFolders(ctx),
  ]);

  return (
    <ChatsView
      workspaceId={workspace.id}
      workspaceSlug={workspaceSegment(workspace)}
      currentUserId={user.id}
      role={membership.role}
      initialChats={chats}
      initialFolders={folders}
      hiddenCount={hiddenCount}
    />
  );
}
