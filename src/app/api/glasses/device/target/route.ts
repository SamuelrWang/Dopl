import { menuHandlers, preflight } from "@/features/glasses/glasses-runtime";

/** Glasses menu: set the device's current voice target (docs/glasses-mcp.md › Menu). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const OPTIONS = preflight;
export const PUT = menuHandlers.target;
