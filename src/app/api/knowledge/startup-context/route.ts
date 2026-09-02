import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  getStartupContext,
} from "@/features/knowledge/server/service";

/**
 * `GET /api/knowledge/startup-context` — the pinned reading list an agent session starts with
 * (T81). The desktop calls it at launch and folds the payload into the spawn prompt; nothing
 * about it is desktop-specific, and any caller that is about to start an agent may read it.
 *
 * The response IS `features/knowledge/server/service-startup-context.ts › StartupContext`:
 * `{ items, omitted, chars, truncated }`. Two of those four keys exist to keep a clipped read
 * from reading like an exhausted one (INVARIANTS §9):
 *   - `omitted` — pinned content that did not fit under the character cap, as an ADDRESS and
 *     never a body, so a consumer can fetch it with `dopl_kb(op="read_file", base, path)`.
 *   - `truncated` — `true` means "there is pinned content you were not given". A consumer must
 *     SAY so rather than presenting the payload as the whole of what is pinned.
 *
 * ⚠ IT IS A READ, AND ITS FLOOR SAYS SO. `withWorkspaceAuth` at the VIEWER default:
 * deliberately not `minRole: "member"` (the two `.../pin` routes carry that — deciding what is
 * pinned is the write; being handed it is not) and deliberately NOT `sessionOnly` (nothing here
 * reaches a person, mints a credential or changes an audience). Every row it returns came out of
 * `service-bases.ts › listBases`, so a caller is only ever handed content it could have fetched
 * one entry at a time.
 *
 * ⚠ NO QUERY PARAMETERS, deliberately. A `?limit=` or `?baseId=` would make the launch payload
 * depend on what a caller asked for, and the point of a pin is that the WORKSPACE decides.
 */
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildKnowledgeContext(auth);
    return NextResponse.json(await getStartupContext(ctx));
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
