import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { toAgentTemplateErrorResponse } from "@/shared/api/agent-template-route";
import {
  buildAgentTemplateContext,
  createTemplate,
  listHomeScopedTemplateIds,
  listTemplates,
} from "@/features/agent-templates/server/service";
import { AgentTemplateCreateSchema } from "@/features/agent-templates/schema";
import type { TemplateShelf } from "@/features/agent-templates/types";

/**
 * `GET /api/agent-templates`  — every template the caller may see.
 * `POST /api/agent-templates` — create one.
 *
 * ⚠ NOT `sessionOnly`, AND THAT IS THE POINT OF THE FEATURE. An orchestrator
 * agent holding an agent token must be able to LIST templates — asking "which
 * identities exist here" is the whole reason they are persistent. The
 * destructive verb is the one that is session-gated; see `[templateId]/route.ts`.
 *
 * ⚠ `homeScopedTemplateIds` IS A SIBLING KEY (2026-08-28), not a field on the row.
 * `home_scoped` stays out of `server/dto.ts › AGENT_TEMPLATE_COLS` so the cached
 * row payload gains no new key and §8's stale-cache rule has nothing to apply to
 * THERE; it applies to this key instead, so every reader spells `?? []`. Only ever
 * a SUBSET of the ids in `templates`.
 *
 * ⚠ EACH ROW CARRIES ITS `visibility` SO THE CLIENT CAN GROUP. The server does
 * not group: which sections a surface wants (a spawn picker vs. a settings page)
 * is a rendering decision, and a pre-grouped payload imposes one of them on
 * every consumer.
 *
 * ⚠ `?shelf=home|workspace` NARROWS THE LIST ITSELF (`features/agent-templates/
 * types.ts › TemplateShelf`, Samuel's ruling 2026-08-27). The /home Agents
 * pane's Personal section asks for `home`; the workspace Agents page asks for
 * `workspace`; the two exclude each other BOTH ways. ABSENT = both shelves,
 * which is every pre-existing caller — the launch picker and MCP ride this route
 * and must keep seeing the whole workspace.
 * 🔒 The narrowing is a `WHERE`, not a post-filter, and it is ORTHOGONAL to
 * `canSeeTemplate`: shelf = which surface lists it, visibility = who may read
 * it. See `readShelf` below for why a misspelled value is a 400.
 */

async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildAgentTemplateContext(auth);
    const templates = await listTemplates(ctx, { shelf: readShelf(request) });
    // ⚠ SIBLING KEY, degrading to `[]` — an unreadable flag means an UNLABELLED
    // row, which is what every surface showed before the key existed. The unsafe
    // direction would be calling a workspace template personal, and no failure
    // mode here produces that. Never a 500: the roster is the answer, the label
    // is decoration over it.
    const homeScopedTemplateIds = await listHomeScopedTemplateIds(
      ctx,
      templates
    ).catch(() => [] as string[]);
    return NextResponse.json({ templates, homeScopedTemplateIds });
  } catch (err) {
    return toAgentTemplateErrorResponse(err);
  }
}

/**
 * `?shelf=home|workspace`. ABSENT = both.
 *
 * 🔒 AN UNRECOGNISED VALUE IS A 400, NOT AN IGNORED PARAM. Silently dropping a
 * misspelled `?shelf=hom` would answer the WIDER list — the workspace shelf
 * folded back into the /home pane — and it would look like it worked. There is
 * no client-side fallback to catch it: `home_scoped` is never projected. Fail
 * loud, fail narrow. Mirrors `api/knowledge/bases/route.ts › readShelf`.
 */
function readShelf(request: NextRequest): TemplateShelf | undefined {
  const raw = request.nextUrl.searchParams.get("shelf");
  if (raw === null) return undefined;
  if (raw === "home" || raw === "workspace") return raw;
  throw new HttpError(400, "VALIDATION_FAILED", "shelf must be 'home' or 'workspace'");
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, AgentTemplateCreateSchema);
    const ctx = buildAgentTemplateContext(auth);
    const template = await createTemplate(ctx, input);
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    return toAgentTemplateErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
