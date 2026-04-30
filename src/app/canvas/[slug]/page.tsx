/**
 * /canvas/[slug] — server component entry point for a specific canvas.
 *
 * Fetches the canvas's full state + conversations from Supabase BEFORE
 * sending HTML to the browser, so the client reducer receives real data
 * on first render. No loading flash, no hydration race.
 *
 * Both loaders (loadCanvasInitialState, loadCanvasConversations) wrap
 * their queries in try/catch and return empty-but-valid state on any
 * failure, so a transient Supabase hiccup degrades to "first-time user
 * experience" rather than breaking the page.
 *
 * Slug resolution: looks up by (owner_id, slug). Membership-via-invite
 * (canvases the user joined but doesn't own) lands in Phase 4 — until
 * then, owner-side lookup covers every reachable canvas.
 *
 * Last-active-canvas persistence is handled client-side (the canvas
 * shell writes `document.cookie` on mount). Server Components can't
 * call `cookies().set()` in Next.js 16 — that throws — so the write
 * has to live on the client or in a Route Handler.
 */

import { notFound, redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import {
  loadCanvasConversations,
  loadCanvasInitialState,
} from "@/features/canvas/server/load-server-state";
import {
  findCanvasForMember,
  resolveMembershipOrThrow,
} from "@/features/canvases/server/service";
import CanvasClientShell from "../canvas-client-shell";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function CanvasSlugPage({ params }: PageProps) {
  const { slug } = await params;

  const user = await getUser();
  if (!user) redirect("/login");

  const canvas = await findCanvasForMember(user.id, slug);
  if (!canvas) notFound();

  // Confirm active membership — `findCanvasForMember` already filters
  // through canvas_members, but the assertion turns a stale-cache miss
  // into a clean 404 instead of a half-rendered canvas.
  await resolveMembershipOrThrow(canvas.id, user.id);

  const scope = { userId: user.id, canvasId: canvas.id };
  const conversations = await loadCanvasConversations(scope);
  const initialState = await loadCanvasInitialState(scope, conversations);

  return (
    <CanvasClientShell
      userId={user.id}
      canvasId={canvas.id}
      canvasSlug={canvas.slug}
      initialState={initialState}
      initialConversations={conversations}
    />
  );
}
