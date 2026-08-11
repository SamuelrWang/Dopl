import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { parseJson } from "@/shared/api/parse-json";
import { requireChannelId, toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  deleteChannel,
  getChannel,
  updateChannel,
} from "@/features/channels/server/service";
import { ChannelUpdateSchema } from "@/features/channels/schema";

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const channel = await getChannel(ctx, requireChannelId(auth.params));
    return NextResponse.json({ channel });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

/**
 * FIELD-LEVEL `sessionOnly` (C-13, Samuel 2026-08-10) — pinned by
 * `src/shared/auth/write-gate-coverage.test.ts`.
 *
 * §9's granularity is per-METHOD, and per-method is wrong HERE: this PATCH is
 * four writes behind one verb (`name`, `topic`, `visibility`, `archived`), and
 * only one of them changes who can see the room. Renaming, re-topicking and
 * archiving are ordinary channel management with no audience consequence, so
 * gating the whole method would spend an agent capability the ruling never
 * asked for. `visibility` is the odd one out and gets its own gate.
 *
 * WHAT IT REFUSES: an agent (`dopl_at_*`) caller changing a channel's
 * visibility at all. Samuel's ruling is about WIDENING — private→public exposes
 * the entire channel and its history to every workspace member, which is the
 * asymmetry C-13 names (raising a prompt is `sessionOnly`; exposing the whole
 * transcript was not). The gate covers BOTH directions because it is simpler
 * and costs nothing: no MCP op and no desktop call reaches this field today
 * (`@dopl/client` has no channel-update method at all — `channel.ts` carries
 * `getChannel` and no PATCH), so there is no narrowing caller to break, and
 * public→private is itself an access change an agent should not make silently.
 * Direction-free also means the gate needs no read of the current row.
 *
 * SESSION CALLERS ARE UNTOUCHED — cookie (web + desktop main) and Supabase-JWT
 * (the bundled SPA) callers never set `agentTokenId`, so the human path through
 * the confirm dialog in `components/go-public-dialog.tsx` is unaffected.
 */
const SESSION_ONLY_FIELDS = ["visibility"] as const;

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const patch = await parseJson(request, ChannelUpdateSchema);
    const gated = SESSION_ONLY_FIELDS.filter((f) => patch[f] !== undefined);
    if (auth.agentTokenId && gated.length > 0) {
      throw new HttpError(
        403,
        "SESSION_REQUIRED",
        `Changing a channel's ${gated.join(", ")} requires an interactive Dopl ` +
          `session and can't be performed over an MCP connection. Sign in to ` +
          `the Dopl app to continue.`
      );
    }
    const ctx = buildChannelContext(auth);
    const channel = await updateChannel(ctx, requireChannelId(auth.params), patch);
    return NextResponse.json({ channel });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    await deleteChannel(ctx, requireChannelId(auth.params));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });
