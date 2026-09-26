import "server-only";
import {
  authenticateDevice,
  json,
  parseInboxQuery,
  preflight,
  readInbox,
} from "@/features/glasses/device";
import { glassesRepository } from "@/features/glasses/repository";
import { mirrorReplies } from "@/features/glasses/reply-mirror";
import { glassesChannelGateway } from "@/features/glasses/voice-channel";
import { voiceConfigFromEnv } from "@/features/glasses/voice-utterance";

/** G2 plugin long-poll (docs/glasses-mcp.md). Holds up to 25s. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function OPTIONS(request: Request): Response {
  return preflight(request);
}

export async function GET(request: Request): Promise<Response> {
  const userId = authenticateDevice(request);
  if (!userId) return json(request, { error: "Unauthorized" }, 401);
  const parsed = parseInboxQuery(new URL(request.url));
  if ("error" in parsed) return json(request, { error: parsed.error }, 400);
  try {
    const voice = voiceConfigFromEnv();
    // Agent replies in the linked channel ride this same long-poll (docs/glasses-mcp.md).
    const beforeRead = voice
      ? async () => {
          await mirrorReplies(
            { store: glassesRepository, gateway: glassesChannelGateway },
            userId,
            voice.channelId,
          );
        }
      : undefined;
    const result = await readInbox(
      { store: glassesRepository, beforeRead },
      userId,
      parsed.after,
      parsed.waitSec,
      request.signal,
    );
    return json(request, result);
  } catch (err) {
    console.error("[glasses] inbox failed", err);
    return json(request, { error: "inbox failed" }, 500);
  }
}
