import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/shared/supabase/server";
import { resolveMembershipOrThrow } from "@/features/workspaces/server/service";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { revealWorkspaceKey } from "@/features/api-keys/server/service";

// Returns a secret — never cache it (browser/proxy/CDN).
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ workspaceSlug: string; id: string }>;
}

/**
 * Reveal the plaintext of one of the CURRENT user's own keys for this
 * workspace (eye-icon + snippet auto-fill). The (user, workspace) owner
 * filter inside `revealWorkspaceKey` means a member can't reveal another
 * member's key. 404 when not found/owned or non-revealable (legacy key
 * with no stored ciphertext). Session-only — never exposed to API keys.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { workspaceSlug, id } = await context.params;
  const workspace = await resolveApiWorkspace(workspaceSlug, user.id);
  if (!workspace) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await resolveMembershipOrThrow(workspace.id, user.id);

  const key = await revealWorkspaceKey(id, user.id, workspace.id);
  if (!key) {
    return NextResponse.json(
      { error: { code: "NOT_REVEALABLE", message: "Key not found or cannot be revealed." } },
      { status: 404 }
    );
  }
  return NextResponse.json(
    { key },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
