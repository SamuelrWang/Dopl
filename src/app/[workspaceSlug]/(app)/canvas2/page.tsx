/**
 * /[workspaceSlug]/canvas2 — static mock of the ontology graph view
 * (Canvas 2). Hardcoded data; exists to evaluate the design language
 * before wiring `GET /api/ontology`.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { Canvas2View } from "@/features/canvas2/components/canvas2-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function Canvas2Page({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  await resolvePageWorkspace(workspaceSlug, user.id, "canvas2");

  return <Canvas2View />;
}
