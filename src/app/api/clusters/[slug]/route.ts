import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DESCRIPTION_MAX } from "@/config";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { ClusterNameSchema } from "@/features/clusters/schema";
import type { Role } from "@/features/workspaces/types";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import {
  deleteCluster,
  getCluster,
  updateCluster,
} from "@/features/clusters/server/service";

interface Ctx {
  userId: string;
  workspaceId: string;
  role: Role;
  agentTokenId?: string;
  params?: Record<string, string>;
}

/**
 * This PATCH — the rename path behind `dopl_cluster(op="update")` — had NO
 * schema at all. It hand-rolled `typeof body.name === "string"` and passed the
 * value straight through with no length bound, let alone a charset one, while
 * the sibling POST capped it at 120: create and rename disagreed about what a
 * cluster may be called, and rename was the one with no opinion. The name now
 * parses against the same schema the collection route uses.
 *
 * `description` keeps its EXISTING semantics deliberately — an over-long one is
 * CLIPPED here, not rejected, because that is what this route has always done
 * and callers may lean on it. Only the name's contract changes.
 */
const ClusterPatchSchema = z.object({
  name: ClusterNameSchema.optional(),
  description: z
    .string()
    .transform((d) => d.slice(0, DESCRIPTION_MAX))
    .nullable()
    .optional(),
});

/**
 * `clusters/server/service.ts` signals a miss with a plain
 * `Error("Cluster not found: <slug>")`. All three tails below used to derive
 * their 404 from that string AND echo the string back verbatim — the slug leak
 * ENGINEERING §9 forbids. The 404 mapping is preserved here; the client now
 * gets a static sentence instead of the raw exception text.
 *
 * `HttpError`s (e.g. `parseJson`'s VALIDATION_FAILED) are handed straight back
 * to the shared tail so they keep their own code and status.
 *
 * THE MATCH IS CASE-SENSITIVE ON PURPOSE. It briefly ran `.toLowerCase()`
 * first, which reads like harmless leniency and is not: this predicate turns
 * an arbitrary `Error` into a 404, and the only sentence it is meant to catch
 * is the service's own lowercase `"Cluster not found: <slug>"`. Widening it to
 * any casing opens the match to wording nobody here controls — a
 * `PostgrestError` phrased "Relation Not Found", a driver message, a future
 * library string — each of which would be answered as a clean 404 for a
 * cluster that exists, hiding a real fault behind a plausible one. Matching
 * the exact string the one intended producer emits keeps the blast radius at
 * that producer.
 */
function mapClusterError(err: unknown): HttpError | null {
  if (err instanceof HttpError) return null;
  if (err instanceof Error && err.message.includes("not found")) {
    return HttpError.notFound("Cluster not found");
  }
  return null;
}

function toClusterErrorResponse(err: unknown): NextResponse {
  return toHttpErrorResponse("api/clusters/[slug]", err, mapClusterError);
}

function scopeOf(ctx: Ctx) {
  return {
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    role: ctx.role,
    source: ctx.agentTokenId ? ("agent" as const) : ("user" as const),
  };
}

async function handleGet(_request: NextRequest, ctx: Ctx) {
  try {
    const slug = ctx.params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    const cluster = await getCluster(slug, scopeOf(ctx));
    return NextResponse.json(cluster);
  } catch (error) {
    return toClusterErrorResponse(error);
  }
}

async function handlePatch(request: NextRequest, ctx: Ctx) {
  try {
    const slug = ctx.params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    const patch = await parseJson(request, ClusterPatchSchema);
    const cluster = await updateCluster(
      slug,
      { name: patch.name, description: patch.description },
      scopeOf(ctx)
    );
    return NextResponse.json(cluster);
  } catch (error) {
    return toClusterErrorResponse(error);
  }
}

async function handleDelete(_request: NextRequest, ctx: Ctx) {
  try {
    const slug = ctx.params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    await deleteCluster(slug, scopeOf(ctx));
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toClusterErrorResponse(error);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });
