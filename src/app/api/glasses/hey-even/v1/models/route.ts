import { heyEvenHandlers, preflight } from "@/features/glasses/glasses-runtime";

/** Hey Even model list (docs/glasses-mcp.md). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const OPTIONS = preflight;
export const GET = heyEvenHandlers.models;
