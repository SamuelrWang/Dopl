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
