import { deviceHandlers, preflight } from "@/features/glasses/glasses-runtime";

/** Device long-poll inbox; holds up to 25s (docs/glasses-mcp.md). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const OPTIONS = preflight;
export const GET = deviceHandlers.inbox;
