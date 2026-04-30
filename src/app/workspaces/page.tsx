/**
 * /workspaces — list every workspace the user owns or belongs to.
 * Server-renders the initial list; the client component handles
 * create/delete and revalidation.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { listMyWorkspaces } from "@/features/workspaces/server/service";
import { WorkspacesList } from "@/features/workspaces/components/workspaces-list";

export const dynamic = "force-dynamic";

export default async function WorkspacesPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const workspaces = await listMyWorkspaces(user.id);

  return (
    <div className="container mx-auto px-4 pt-24 pb-16 max-w-3xl">
      <WorkspacesList initial={workspaces} />
    </div>
  );
}
