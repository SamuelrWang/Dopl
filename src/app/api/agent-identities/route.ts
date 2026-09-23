import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { toAgentIdentityErrorResponse } from "@/shared/api/agent-identity-route";
import {
  buildAgentIdentityContext,
  createIdentity,
  listHomeScopedIdentityIds,
  listIdentities,
} from "@/features/agent-identities/server/service";
import { AgentIdentityCreateSchema } from "@/features/agent-identities/schema";
import type { IdentityShelf } from "@/features/agent-identities/types";

/**
 * `GET /api/agent-identities` (every identity the caller may see) and `POST` (create). Not
 * `sessionOnly`: an orchestrator agent must be able to list identities. `?shelf=home|workspace`
 * narrows the query (absent = both); `homeScopedIdentityIds` is a sibling key, a subset of the ids.
 */

async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildAgentIdentityContext(auth);
    const identities = await listIdentities(ctx, { shelf: readShelf(request) });
    // A failed label read degrades to `[]` (unlabelled, never mislabelled) — the roster still answers.
    const homeScopedIdentityIds = await listHomeScopedIdentityIds(
      ctx,
      identities
    ).catch((err: unknown) => {
      console.warn("agent-identities: homeScopedIdentityIds failed", err);
      return [] as string[];
    });
    return NextResponse.json({ identities, homeScopedIdentityIds });
  } catch (err) {
    return toAgentIdentityErrorResponse(err);
  }
}

/** `?shelf=`; absent = both. An unknown value is a 400 — ignoring it would answer the wider list. */
function readShelf(request: NextRequest): IdentityShelf | undefined {
  const raw = request.nextUrl.searchParams.get("shelf");
  if (raw === null) return undefined;
  if (raw === "home" || raw === "workspace") return raw;
  throw new HttpError(400, "VALIDATION_FAILED", "shelf must be 'home' or 'workspace'");
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, AgentIdentityCreateSchema);
    const ctx = buildAgentIdentityContext(auth);
    const identity = await createIdentity(ctx, input);
    return NextResponse.json({ identity }, { status: 201 });
  } catch (err) {
    return toAgentIdentityErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
