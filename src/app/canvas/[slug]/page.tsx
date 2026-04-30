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
 */

import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
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

const ACTIVE_CANVAS_COOKIE = "dopl_active_canvas";

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

  // Persist as last-active so plain `/canvas` redirects here on return.
  const cookieJar = await cookies();
  cookieJar.set(ACTIVE_CANVAS_COOKIE, canvas.slug, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

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
