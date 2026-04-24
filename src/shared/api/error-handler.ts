import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import { logSystemEvent } from "@/features/analytics/server/system-events";

type RouteHandler<Ctx> = (
  req: Request,
  ctx: Ctx
) => Promise<Response | NextResponse>;

/**
 * Wrap a route handler so thrown `HttpError`s become typed JSON responses,
 * and unexpected exceptions become generic 500s with a system_events row.
 *
 * `source` is the stable identifier logged to system_events — typically
 * something like "POST /api/chat" or "chat.tools.ingest-url". Keep it
 * stable across occurrences so the grouping fingerprint is meaningful.
 *
 * Usage (composable with auth wrappers):
 *   export const POST = withUserAuth(withErrorHandler("POST /api/x", async (req, { userId }) => {
 *     const input = await parseJson(req, Schema);
 *     return NextResponse.json(await doThing(input, userId));
 *   }));
 */
export function withErrorHandler<Ctx>(
  source: string,
  handler: RouteHandler<Ctx>
): RouteHandler<Ctx> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(err.toResponseBody(), { status: err.status });
      }

      const name = err instanceof Error ? err.name : "UnknownError";
      const message = err instanceof Error ? err.message : String(err);
      void logSystemEvent({
        severity: "error",
        category: "other",
        source,
        message: `Unhandled error in route: ${message}`,
        fingerprintKeys: ["unhandled_route_error", source, name],
        metadata: { error_name: name },
      });

      return NextResponse.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "An unexpected error occurred",
          },
        },
        { status: 500 }
      );
    }
  };
}
