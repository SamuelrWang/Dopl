/**
 * /[workspaceSlug]/chats — the agent-exported chat archive.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
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

  const ctx = buildChatContext({
    userId: user.id,
    workspaceId: workspace.id,
    agentTokenId: null,
  });
  const [chats, folders] = await Promise.all([listChats(ctx), listFolders(ctx)]);

  return (
    <ChatsView
      workspaceId={workspace.id}
      currentUserId={user.id}
      initialChats={chats}
      initialFolders={folders}
    />
  );
}
