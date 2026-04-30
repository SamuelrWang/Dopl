/**
 * /canvases — list page for every canvas the user owns or belongs to.
 * Server-renders the initial list; the client component handles
 * create/delete and revalidation.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { listMyCanvases } from "@/features/canvases/server/service";
import { CanvasesList } from "@/features/canvases/components/canvases-list";

export const dynamic = "force-dynamic";

export default async function CanvasesPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const canvases = await listMyCanvases(user.id);

  return (
    <div className="container mx-auto px-4 pt-24 pb-16 max-w-3xl">
      <CanvasesList initial={canvases} />
    </div>
  );
}
