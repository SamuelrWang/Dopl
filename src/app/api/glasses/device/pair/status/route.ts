import { deviceHandlers, preflight } from "@/features/glasses/glasses-runtime";

/** Device pairing: poll; returns the device token once (docs/glasses-mcp.md). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const OPTIONS = preflight;
export const GET = deviceHandlers.pairStatus;
