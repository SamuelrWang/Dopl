import { notFound, redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import {
  findWorkspaceForMember,
  resolveMembershipOrThrow,
} from "@/features/workspaces/server/service";
import { MembersView } from "@/features/members/components/members-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function MembersPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await findWorkspaceForMember(user.id, workspaceSlug);
  if (!workspace) notFound();
  const { membership } = await resolveMembershipOrThrow(workspace.id, user.id);

  return (
    <MembersView
      workspaceSlug={workspace.slug}
      workspaceId={workspace.id}
      currentUserId={user.id}
      myRole={membership.role}
    />
  );
}
