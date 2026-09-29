import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import { HttpError } from "@/shared/lib/http-error";
import { buildChannelContext } from "@/features/channels/server/service";
import { GlassesValidationError } from "@/features/glasses/core/validation";
import { DisplayInputError } from "@/features/display/core/template";
import { showDisplay, ShowInputSchema } from "@/features/display/server/service";

/**
 * POST — show a display (docs/specs/unified-display.md §4): `dopl_show` and every glasses shortcut.
 * Holds ≤205s with `wait`, so the function budget is the MCP route's.
 */
export const maxDuration = 300;

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ShowInputSchema);
    // An agent's display: no member device to stamp (`withMessageSource` would return ctx as is).
    return NextResponse.json(await showDisplay(buildChannelContext(auth), input, request.signal));
  } catch (err) {
    const fixable = err instanceof DisplayInputError || err instanceof GlassesValidationError;
    return toChannelErrorResponse(fixable ? new HttpError(400, "DISPLAY_INVALID", err.message) : err);
  }
}

// The workspace floor stays the default (a guest's lane is the messages route, INVARIANTS §4A);
// channel membership is the real gate, in `postMessage`.
export const POST = withWorkspaceAuth(handlePost);
