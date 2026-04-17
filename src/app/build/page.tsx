/**
 * /build — server component entry point, mirrors /canvas.
 *
 * Fetches the user's canvas state + conversations from Supabase before
 * rendering, so `CanvasProvider` receives real data on first render and
 * the builder sidebar can immediately read the user's clusters from
 * context without a loading flash.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase-server";
import {
  loadCanvasInitialState,
  loadUserConversations,
} from "@/lib/canvas/load-server-state";
import BuildClientShell from "./build-client-shell";

export const dynamic = "force-dynamic";

export default async function BuildPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const conversations = await loadUserConversations(user.id);
  const initialState = await loadCanvasInitialState(user.id, conversations);

  return (
    <BuildClientShell
      userId={user.id}
      initialState={initialState}
      initialConversations={conversations}
    />
  );
}
