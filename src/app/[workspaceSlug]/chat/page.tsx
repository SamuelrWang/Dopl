/**
 * /[workspaceSlug]/chat — workspace chat page.
 *
 * Stub for now. Will host the in-product chat UI (thread with
 * Dopl's agent, scoped to the active workspace) when the chat slice
 * ships.
 */

import { notFound, redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { findWorkspaceForMember } from "@/features/workspaces/server/service";
import { PageTopBar } from "@/shared/layout/page-top-bar";

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
      <div className="container mx-auto max-w-6xl px-6 pt-[68px] pb-8 pointer-events-auto">
        <div
          className="rounded-xl border border-white/[0.06] p-8"
          style={{ backgroundColor: "oklch(0.13 0 0)" }}
        >
          <p className="text-sm text-text-secondary">
            Chat for{" "}
            <span className="text-text-primary font-medium">
              {workspace.name}
            </span>{" "}
            — coming soon.
          </p>
        </div>
      </div>
    </>
  );
}
