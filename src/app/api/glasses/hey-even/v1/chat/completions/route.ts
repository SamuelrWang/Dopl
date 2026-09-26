import { preflight } from "@/features/glasses/cors";
import { voiceHandlers } from "@/features/glasses/glasses-runtime";

/** Hey Even chat completions (OpenAI path) (docs/glasses-mcp.md). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const OPTIONS = preflight;
export const POST = voiceHandlers.heyEven;
