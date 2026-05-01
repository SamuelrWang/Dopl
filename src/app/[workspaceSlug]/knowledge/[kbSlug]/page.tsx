/**
 * /[workspaceSlug]/knowledge/[kbSlug] — single knowledge base detail.
 *
 * Hardcoded data for now. Looks up the KB in the static list; will
 * be replaced with a Supabase-backed fetch once the knowledge backend
 * slice ships.
 */

import { notFound, redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { findWorkspaceForMember } from "@/features/workspaces/server/service";
import { findKnowledgeBase } from "@/features/knowledge/data";
import { KnowledgeBaseView } from "@/features/knowledge/components/knowledge-base-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string; kbSlug: string }>;
}

export default async function KnowledgeBaseDetailPage({ params }: PageProps) {
  const { workspaceSlug, kbSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await findWorkspaceForMember(user.id, workspaceSlug);
  if (!workspace) notFound();

  const kb = findKnowledgeBase(kbSlug);
  if (!kb) notFound();

  return <KnowledgeBaseView kb={kb} />;
}
