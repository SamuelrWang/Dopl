import "server-only";
import { authenticateDevice, json, preflight } from "@/features/glasses/device";
import { modelList } from "@/features/glasses/voice";

/** Hey Even model discovery: one model, `dopl-glasses`. */
export const dynamic = "force-dynamic";

export function OPTIONS(request: Request): Response {
  return preflight(request);
}

export function GET(request: Request): Response {
  if (!authenticateDevice(request)) return json(request, { error: { message: "Unauthorized" } }, 401);
  return json(request, modelList(Math.floor(Date.now() / 1000)));
}
