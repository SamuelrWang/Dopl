/**
 * /canvas — server component entry point.
 *
 * Fetches the user's full canvas state + conversations from Supabase
 * BEFORE sending HTML to the browser, so the client reducer receives
 * real data on first render. No loading flash, no hydration race.
 *
 * Both loaders (loadCanvasInitialState, loadUserConversations) wrap
 * their queries in try/catch and return empty-but-valid state on any
 * failure, so a transient Supabase hiccup degrades to "first-time user
 * experience" rather than breaking the page.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import {
  loadCanvasInitialState,
  loadUserConversations,
} from "@/lib/canvas/load-server-state";
import CanvasClientShell from "./canvas-client-shell";

// Per-request evaluation — never cache user canvas HTML across users.
export const dynamic = "force-dynamic";

export default async function CanvasPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  // Load conversations first so we can stitch messages into chat panels
  // before the reducer ever sees the state.
  const conversations = await loadUserConversations(user.id);
  const initialState = await loadCanvasInitialState(user.id, conversations);

  return (
    <CanvasClientShell
      userId={user.id}
      initialState={initialState}
      initialConversations={conversations}
    />
  );
}
