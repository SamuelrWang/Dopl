import { voiceHandlers, preflight } from "@/features/glasses/glasses-runtime";

/** Device push-to-talk: PCM in, transcript + channel outcome out (docs/glasses-mcp.md). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const OPTIONS = preflight;
export const POST = voiceHandlers.voice;
