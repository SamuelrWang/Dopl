import { preflight } from "@/features/glasses/cors";
import { deviceHandlers } from "@/features/glasses/glasses-runtime";

/** Device: answer an ask or tap a screen (docs/glasses-mcp.md). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const OPTIONS = preflight;
export const POST = deviceHandlers.answer;
