/**
 * /[workspaceSlug]/skills/[skillSlug] — legacy deep link.
 *
 * The skill editor now renders inline on the skills index (no separate
 * detail route). Old bookmarks and agent-rendered links land here, so
 * redirect them to the index rather than 404ing.
 */

import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ workspaceSlug: string; skillSlug: string }>;
}

export default async function SkillDetailRedirect({ params }: PageProps) {
  const { workspaceSlug } = await params;
  redirect(`/${workspaceSlug}/skills`);
}
