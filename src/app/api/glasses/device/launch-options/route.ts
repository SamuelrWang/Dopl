import { menuHandlers, preflight } from "@/features/glasses/glasses-runtime";

/** Glasses menu: runtimes and models to start an agent with (docs/glasses-mcp.md › Menu). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const OPTIONS = preflight;
export const GET = menuHandlers.launchOptions;
