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
