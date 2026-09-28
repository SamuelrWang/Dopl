import { menuHandlers, preflight } from "@/features/glasses/glasses-runtime";

/** Glasses menu: start an agent through Dopl's launch path (holds up to 10s) (docs/glasses-mcp.md › Menu). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const OPTIONS = preflight;
export const POST = menuHandlers.launch;
