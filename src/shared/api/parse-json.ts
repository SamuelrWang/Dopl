import "server-only";
import type { z } from "zod";
import { HttpError } from "@/shared/lib/http-error";

/**
 * Parse and validate a JSON request body.
 *
 * Throws:
 *   - HttpError(400, "INVALID_JSON") if the body is not valid JSON.
 *   - HttpError(400, "VALIDATION_FAILED", ..., issues) if zod validation fails.
 *     `details` is the zod issues array so clients can surface field-level errors.
 *
 * Usage:
 *   const input = await parseJson(req, SomeSchema);
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
 * The ENGINEERING §9 envelope for a caught `HttpError`, with the FIRST zod
 * issue's own message promoted into `error.message`.
 *
 * `parseJson` reports every validation failure as the generic "Request body
 * failed validation" and puts the issue list in `details`. That is the right
 * default for an API, and wrong for a form: a person renaming their workspace
 * types a name with a newline in it and reads "Request body failed validation",
 * which tells them nothing about what to change. Routes behind a form call this
 * instead, so the schema's own sentence ("Workspace name cannot contain
 * control, zero-width, or line-separator characters") is what the field shows.
 * The full issue list stays in `details` either way.
 *
 * Same promotion `PATCH /api/user/profile` does inline; this is its shared home
 * so the next form-backed route does not hand-roll a third copy.
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
