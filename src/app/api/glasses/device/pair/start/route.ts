import { preflight } from "@/features/glasses/cors";
import { deviceHandlers } from "@/features/glasses/glasses-runtime";

/** Device pairing: allocate a code (unauthenticated, per-IP limited) (docs/glasses-mcp.md). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const OPTIONS = preflight;
export const POST = deviceHandlers.pairStart;
