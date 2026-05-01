/**
 * /[workspaceSlug]/settings — per-workspace settings. Shows General
 * (rename + description) for admins/owners, the Members section (any
 * member can read; admins can invite/re-role/remove), and the Danger
 * zone (delete) for owners.
 */

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/shared/supabase/server";
import {
  findWorkspaceForMember,
  resolveMembershipOrThrow,
} from "@/features/workspaces/server/service";
import { WorkspaceSettingsForm } from "@/features/workspaces/components/workspace-settings-form";
import { WorkspaceMembersSection } from "@/features/workspaces/components/workspace-members-section";
import { WorkspaceKeysSection } from "@/features/api-keys/components/workspace-keys-section";
import { meetsMinRole } from "@/features/workspaces/types";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function WorkspaceSettingsPage({ params }: PageProps) {
  const { workspaceSlug } = await params;

  const user = await getUser();
  if (!user) redirect("/login");

  const workspace = await findWorkspaceForMember(user.id, workspaceSlug);
  if (!workspace) notFound();
  const { membership } = await resolveMembershipOrThrow(workspace.id, user.id);

  return (
    <div className="container mx-auto px-4 pt-24 pb-16 max-w-2xl">
      <Link
        href="/workspaces"
        className="text-[10px] uppercase tracking-wider text-white/40 hover:text-white/70 transition-colors"
      >
        ← All workspaces
      </Link>
      <div className="mt-3 mb-6">
        <h1 className="text-2xl font-semibold text-white">{workspace.name}</h1>
        <p className="text-xs text-white/40 mt-1 font-mono">
          /{workspace.slug}
        </p>
      </div>
      <div className="space-y-8">
        <WorkspaceSettingsForm workspace={workspace} role={membership.role} />
        <WorkspaceMembersSection
          workspaceSlug={workspace.slug}
          myUserId={user.id}
          myRole={membership.role}
        />
        <WorkspaceKeysSection
          workspaceSlug={workspace.slug}
          canCreate={meetsMinRole(membership.role, "admin")}
        />
      </div>
    </div>
  );
}
