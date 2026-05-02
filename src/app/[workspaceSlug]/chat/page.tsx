/**
 * /[workspaceSlug]/chat — workspace chat page.
 *
 * Hosts the conversations rail + chat thread + reference detail panel
 * in a single shared shell (knowledge-detail-style layout).
 */

import { notFound, redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { findWorkspaceForMember } from "@/features/workspaces/server/service";
import { PageTopBar } from "@/shared/layout/page-top-bar";
import { ChatShell } from "@/features/chat/components/chat-shell";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function ChatPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await findWorkspaceForMember(user.id, workspaceSlug);
  if (!workspace) notFound();

  return (
    <>
      <PageTopBar title="Chat" />
      <ChatShell />
    </>
  );
}
