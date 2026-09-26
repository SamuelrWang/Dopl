import "server-only";
import {
  authenticateDevice,
  answerAsk,
  json,
  preflight,
} from "@/features/glasses/device";
import { glassesRepository } from "@/features/glasses/repository";

/** G2 plugin: answer a message (docs/glasses-mcp.md). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export function OPTIONS(request: Request): Response {
  return preflight(request);
}

export async function POST(request: Request): Promise<Response> {
  const userId = authenticateDevice(request);
  if (!userId) return json(request, { error: "Unauthorized" }, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(request, { error: "body must be JSON" }, 400);
  }
  try {
    const outcome = await answerAsk({ store: glassesRepository }, userId, body);
    return outcome.ok
      ? json(request, { ok: true })
      : json(request, { ok: false, error: outcome.error }, outcome.status);
  } catch (err) {
    console.error("[glasses] answer failed", err);
    return json(request, { error: "answer failed" }, 500);
  }
}
