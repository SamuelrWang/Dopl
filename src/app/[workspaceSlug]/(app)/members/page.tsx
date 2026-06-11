import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolveMembershipOrThrow } from "@/features/workspaces/server/service";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { workspaceSegment } from "@/features/workspaces/url";
import { AppPanel } from "@/shared/layout/app-shell";
import { MembersView } from "@/features/members/components/members-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function MembersPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await resolvePageWorkspace(workspaceSlug, user.id, "members");
  const { membership } = await resolveMembershipOrThrow(workspace.id, user.id);

  return (
    <AppPanel>
      <MembersView
        workspaceSlug={workspaceSegment(workspace)}
        currentUserId={user.id}
        myRole={membership.role}
      />
    </AppPanel>
  );
}
