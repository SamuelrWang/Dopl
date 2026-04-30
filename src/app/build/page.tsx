/**
 * /build — server component entry point, mirrors /canvas.
 *
 * Fetches the user's canvas state + conversations from Supabase before
 * rendering, so `CanvasProvider` receives real data on first render and
 * the builder sidebar can immediately read the user's clusters from
 * context without a loading flash.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import {
  loadCanvasConversations,
  loadCanvasInitialState,
} from "@/features/canvas/server/load-server-state";
import { ensureDefaultCanvas } from "@/features/canvases/server/service";
import BuildClientShell from "./build-client-shell";

export const dynamic = "force-dynamic";

export default async function BuildPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const canvas = await ensureDefaultCanvas(user.id);
  const scope = { userId: user.id, canvasId: canvas.id };

  const conversations = await loadCanvasConversations(scope);
  const initialState = await loadCanvasInitialState(scope, conversations);

  return (
    <BuildClientShell
      userId={user.id}
      canvasId={canvas.id}
      canvasSlug={canvas.slug}
      initialState={initialState}
      initialConversations={conversations}
    />
  );
}
