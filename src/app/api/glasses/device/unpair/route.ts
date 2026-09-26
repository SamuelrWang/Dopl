import { preflight } from "@/features/glasses/cors";
import { deviceHandlers } from "@/features/glasses/glasses-runtime";

/** Device: revoke itself before forgetting its token (docs/glasses-mcp.md). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const OPTIONS = preflight;
export const POST = deviceHandlers.unpair;
