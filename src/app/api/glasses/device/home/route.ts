import { preflight } from "@/features/glasses/cors";
import { menuHandlers } from "@/features/glasses/glasses-runtime";

/** Glasses menu home: recent agents + channels (docs/glasses-mcp.md › Menu). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const OPTIONS = preflight;
export const GET = menuHandlers.home;
