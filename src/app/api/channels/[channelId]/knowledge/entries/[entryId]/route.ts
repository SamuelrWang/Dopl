import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import { requireChannelKnowledgeContext } from "@/shared/api/channel-knowledge-lane";
import {
  getGrantedEntry,
  updateGrantedEntry,
} from "@/features/knowledge/server/service-channel-lane";
import { ChannelLaneEntryUpdateSchema } from "@/features/knowledge/schema";

/**
 * `GET|PUT /api/channels/{channelId}/knowledge/entries/{entryId}` — ONE entry of
 * a base granted into this channel, and the guest's edit of it (Home Knowledge
 * Panels M2, §3.1 / §3.4).
 *
 * ── The fences, in order (§3.2), identical for both methods ────────────────
 *  1. `withWorkspaceAuth(..., {minRole:"guest"})` — the floor (tripwire).
 *  2. `loadVisibleChannel` + 🔒 `membership !== null` — see
 *     `shared/api/channel-knowledge-lane.ts`.
 *  3. The grant row: `visible` for the GET, `visible` AND `guest_write` for the
 *     PUT. `agent_only` is a 404 on both, always.
 *  4. Base alive + same workspace.
 *
 * ── 🔒 The entry id is CHASED UP TO ITS BASE ───────────────────────────────
 * This route is addressed by ENTRY, and an entry id says nothing about a
 * channel. So the service resolves the entry, walks to its
 * `knowledge_base_id`, and asks the grant question THERE — an entry belonging to
 * a base that is not granted onto this channel is a 404, indistinguishable from
 * an entry that does not exist. Same for one in another workspace.
 *
 * ── 🔒 The write (PUT), §3.4 ───────────────────────────────────────────────
 * Body is `{body?, title?, expectedVersion?}` and nothing else, `.strict()`, so
 * a caller reaching for `position` or `folderId` gets a 400 rather than a silent
 * drop. `agent_write_enabled` is NOT consulted — it answers a question about
 * AGENTS, and `assertGrantWritable` refuses an agent token on this lane outright
 * so that premise is enforced rather than assumed. The stamp is
 * `last_edited_by = ctx.userId`, `last_edited_source = 'user'` (the literal).
 *
 * ⚠ THE SERVICE IS THE FENCE, NOT RLS. Everything below here runs on the
 * service-role client; the `knowledge_entries` policies never fire for this
 * caller. There is no second line of defence behind `assertGrantWritable`.
 *
 * ⚠ NOT `sessionOnly`. The gate that matters is the agent refusal in the
 * service, which is narrower and states its reason at the point of refusal; the
 * `sessionOnly` set is pinned by `shared/auth/write-gate-coverage.test.ts` and
 * this route deliberately does not join it — it writes CONTENT the caller was
 * already shown, it mints nothing, and it widens nobody's audience. The route
 * that DOES widen an audience (`PUT …/channel-grants`, M1) is on that list.
 */

function requireEntryId(auth: WorkspaceAuthContext): string {
  const id = auth.params?.entryId;
  if (!id) throw HttpError.badRequest("entryId is required");
  return id;
}

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const entryId = requireEntryId(auth);
    const ctx = await requireChannelKnowledgeContext(auth);
    const entry = await getGrantedEntry(ctx, entryId);
    return NextResponse.json({ entry });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handlePut(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const entryId = requireEntryId(auth);
    const input = await parseJson(request, ChannelLaneEntryUpdateSchema);
    const ctx = await requireChannelKnowledgeContext(auth);
    const entry = await updateGrantedEntry(ctx, entryId, input);
    return NextResponse.json({ entry });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

// ⚠ `minRole: "guest"` on BOTH — INVARIANTS §4A, and two deliberate entries in
// `channels/guest-route-floor.test.ts › GUEST_ALLOWED` (the one file on that
// list contributing two methods since `members/route.ts`).
export const GET = withWorkspaceAuth(handleGet, { minRole: "guest" });
export const PUT = withWorkspaceAuth(handlePut, { minRole: "guest" });
