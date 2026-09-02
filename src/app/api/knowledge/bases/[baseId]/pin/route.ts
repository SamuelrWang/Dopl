import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import { buildKnowledgeContext, pinBase } from "@/features/knowledge/server/service";

/**
 * `PUT|DELETE /api/knowledge/bases/{baseId}/pin` — whether this base's entries are handed to every
 * agent session launched in the workspace (T81, `service-startup-context.ts`).
 *
 * ⚠ A WORKSPACE FACT, NOT A FAVOURITE. The `star` route beside this one writes the CALLER'S own
 * row and two members see different results; a pin writes the base and everybody's launch context
 * changes with it. That is the whole reason the floor differs — see the wrapper note below.
 *
 * ⚠ TWO IDEMPOTENT VERBS, NOT ONE TOGGLE — `star`'s argument verbatim, and it bites harder here.
 * A toggle's outcome depends on state the client cannot see at send time, so a retry after a
 * timeout that actually landed silently un-does the write; on shared state that un-does it for
 * every member and every session launched afterwards.
 *
 * ⚠ THERE IS DELIBERATELY NO PATCH ARM ON THE BASE ROUTE. `pinned` is absent from
 * `features/knowledge/schema.ts › KnowledgeBaseUpdateSchema`, so this file is the only door;
 * adding the field there would be a second one, with a second gate to keep in step. (Its
 * near-twin `home_scoped` is create-only for a different reason — a shelf is TENANCY. See
 * `features/knowledge/server/service-pins.ts`.)
 */

function requireBaseId(auth: WorkspaceAuthContext): string {
  const id = auth.params?.baseId;
  if (!id) throw HttpError.badRequest("baseId is required");
  return id;
}

async function setPinned(auth: WorkspaceAuthContext, pinned: boolean) {
  try {
    const ctx = buildKnowledgeContext(auth);
    // 🔒 Visibility-gated in the service, in BOTH directions: `getBaseById` 404s a foreign base,
    // one the private/teams gate hides, and one outside a locked agent's audience ceiling — one
    // answer, so neither verb can probe whether an id is real.
    await pinBase(ctx, requireBaseId(auth), pinned);
    return NextResponse.json({ pinned });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handlePut(_request: NextRequest, auth: WorkspaceAuthContext) {
  return setPinned(auth, true);
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  return setPinned(auth, false);
}

/**
 * ⚠ `minRole: "member"` ON BOTH VERBS, where `star` takes the wrapper's viewer default. A viewer
 * may read this base and bookmark it for themselves; deciding what every agent in the workspace
 * starts its session with is an edit to shared state, and the UNPIN is gated for the same reason
 * as the pin — removing somebody else's launch context is as much a write as adding one.
 *
 * ⚠ NEITHER IS `sessionOnly`. A pin reaches no person, mints no credential and changes no
 * audience: it decides only whether an agent is HANDED content its caller could already read
 * (INVARIANTS §3 — the `infoCard` reasoning, one feature over).
 */
export const PUT = withWorkspaceAuth(handlePut, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });
