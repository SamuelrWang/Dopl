/**
 * /canvas — redirect entry point.
 *
 * Resolves the user's last-active canvas from a cookie (set by
 * /canvas/[slug] on every visit) and redirects there. Falls back to the
 * user's default canvas, which is created on demand if missing — this
 * covers brand-new sign-ups whose default-canvas backfill row hasn't
 * landed yet.
 */

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getUser } from "@/shared/supabase/server";
import {
  ensureDefaultCanvas,
  findCanvasBySlugForUser,
} from "@/features/canvases/server/service";

const ACTIVE_CANVAS_COOKIE = "dopl_active_canvas";

export const dynamic = "force-dynamic";

export default async function CanvasIndexPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const cookieJar = await cookies();
  const lastSlug = cookieJar.get(ACTIVE_CANVAS_COOKIE)?.value;

  if (lastSlug) {
    const canvas = await findCanvasBySlugForUser(user.id, lastSlug);
    if (canvas) redirect(`/canvas/${canvas.slug}`);
  }

  const canvas = await ensureDefaultCanvas(user.id);
  redirect(`/canvas/${canvas.slug}`);
}
