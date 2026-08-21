import "server-only";
import type { z } from "zod";
import { HttpError } from "@/shared/lib/http-error";

/**
 * Parse and validate a JSON request body. Throws
 * `HttpError(400, "INVALID_JSON")` on bad JSON, or
 * `HttpError(400, "VALIDATION_FAILED", ..., issues)` on zod failure, where
 * `details` is the zod issues array for field-level errors.
 */
export async function parseJson<T>(
  req: Request,
  schema: z.ZodType<T>
): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body is not valid JSON");
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new HttpError(
      400,
      "VALIDATION_FAILED",
      "Request body failed validation",
      result.error.issues
    );
  }

  return result.data;
}

/**
 * Parse and validate QUERY PARAMS against a schema — the `?a=b` twin of
 * {@link parseJson}, and the same `HttpError(400, "VALIDATION_FAILED", …, issues)`.
 *
 * ⚠ IT EXISTS BECAUSE FOUR HAND-WRITTEN COPIES DISAGREED (2026-08-20). Every route
 * that read a query param wrote its own `searchParams` → `safeParse` → `throw`
 * block, and the copies drifted on the one line that matters:
 * `/channels/sessions` used `|| undefined` while `/channels/consent` used
 * `?? undefined`. Against the SAME `?channelId=` shape those answer differently —
 * `||` turns an empty string into "no filter" and returns EVERY session in the
 * workspace, `??` lets `""` reach the schema and 400s. A filter that silently
 * becomes "no filter" is the direction that leaks rows.
 *
 * ⚠ **THE RULE IS `??`: AN EMPTY STRING IS A VALUE THE CALLER SENT, AND IT GOES TO
 * THE SCHEMA.** `?channelId=` is not the same request as omitting `channelId`, and
 * only the schema gets to decide whether it is acceptable. Never widen this to
 * `||` to "be forgiving" — forgiving here means answering a different question
 * than the one asked.
 *
 * An ABSENT param is `undefined`, which is what `.optional()` is for.
 */
export function parseQuery<T>(
  params: URLSearchParams,
  schema: z.ZodType<T>,
  keys: readonly string[]
): T {
  const raw: Record<string, string | undefined> = {};
  for (const key of keys) raw[key] = params.get(key) ?? undefined;

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new HttpError(
      400,
      "VALIDATION_FAILED",
      "Invalid query",
      result.error.issues
    );
  }

  return result.data;
}

/**
 * ENGINEERING §9 envelope for a caught `HttpError`, with the FIRST zod issue's
 * own message promoted into `error.message`.
 *
 * `parseJson`'s generic "Request body failed validation" is right for an API and
 * wrong for a form — it tells the person nothing about what to change. Routes
 * behind a form call this so the schema's own sentence is what the field shows.
 * The full issue list stays in `details` either way.
 */
export function validationResponseBody(err: HttpError) {
  const body = err.toResponseBody();
  const issues = err.details;
  if (Array.isArray(issues) && issues.length > 0) {
    const first = issues[0] as { message?: unknown };
    if (typeof first?.message === "string" && first.message) {
      body.error.message = first.message;
    }
  }
  return body;
}
