/**
 * /[workspaceSlug]/chats — the agent-exported chat archive. Mock-backed
 * UI until the archive backend lands.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { ChatsView } from "@/features/chats/components/chats-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function ChatsPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  await resolvePageWorkspace(workspaceSlug, user.id, "chats");

  return <ChatsView />;
}
