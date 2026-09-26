import "server-only";
import {
  authenticateDevice,
  json,
  parseInboxQuery,
  preflight,
  readInbox,
} from "@/features/glasses/device";
import { glassesRepository } from "@/features/glasses/repository";

/** G2 plugin long-poll (docs/glasses-mcp.md). Holds up to 25s. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function OPTIONS(request: Request): Response {
  return preflight(request);
}

export async function GET(request: Request): Promise<Response> {
  const userId = authenticateDevice(request);
  if (!userId) return json(request, { error: "Unauthorized" }, 401);
  const parsed = parseInboxQuery(new URL(request.url));
  if ("error" in parsed) return json(request, { error: parsed.error }, 400);
  try {
    const result = await readInbox(
      { store: glassesRepository },
      userId,
      parsed.after,
      parsed.waitSec,
      request.signal,
    );
    return json(request, result);
  } catch (err) {
    console.error("[glasses] inbox failed", err);
    return json(request, { error: "inbox failed" }, 500);
  }
}
