/**
 * /[workspaceSlug]/knowledge/[kbSlug]/settings — knowledge-base settings.
 *
 * Server component. Resolves workspace + base, renders the settings
 * form. The form owns its own mutation state.
 */

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/shared/supabase/server";
import { findWorkspaceForMember } from "@/features/workspaces/server/service";
import {
  buildKnowledgeContext,
  getBaseBySlug,
} from "@/features/knowledge/server/service";
import { KnowledgeBaseNotFoundError } from "@/features/knowledge/server/errors";
import { BaseSettingsForm } from "@/features/knowledge/components/base-settings-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string; kbSlug: string }>;
}

export default async function KnowledgeBaseSettingsPage({
  params,
}: PageProps) {
  const { workspaceSlug, kbSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await findWorkspaceForMember(user.id, workspaceSlug);
  if (!workspace) notFound();

  const ctx = buildKnowledgeContext({
    userId: user.id,
    workspaceId: workspace.id,
    apiKeyId: null,
  });

  let base;
  try {
    base = await getBaseBySlug(ctx, kbSlug);
  } catch (err) {
    if (err instanceof KnowledgeBaseNotFoundError) notFound();
    throw err;
  }

  return (
    <div className="container mx-auto px-4 pt-24 pb-16 max-w-2xl">
      <Link
        href={`/${workspaceSlug}/knowledge/${base.slug}`}
        className="text-[10px] uppercase tracking-wider text-white/40 hover:text-white/70 transition-colors"
      >
        ← Back to {base.name}
      </Link>
      <div className="mt-3 mb-8">
        <h1 className="text-2xl font-semibold text-white">
          {base.name} settings
        </h1>
        <p className="text-xs text-white/40 mt-1 font-mono">
          /{workspace.slug}/knowledge/{base.slug}
        </p>
      </div>
      <BaseSettingsForm
        workspaceId={workspace.id}
        workspaceSlug={workspace.slug}
        base={base}
      />
    </div>
  );
}
