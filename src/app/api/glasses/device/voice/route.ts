import "server-only";
import { authenticateDevice, json, preflight } from "@/features/glasses/device";
import { sttProviderFromEnv } from "@/features/glasses/stt";
import { VoiceInputError, handleVoiceUpload } from "@/features/glasses/voice";
import { glassesChannelGateway } from "@/features/glasses/voice-channel";
import { UtteranceError, voiceConfigFromEnv } from "@/features/glasses/voice-utterance";

/**
 * G2 push-to-talk: raw PCM s16le 16 kHz mono in, transcript + channel outcome
 * out (docs/glasses-mcp.md). Holds up to ~8s for the agent's first reply.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function OPTIONS(request: Request): Response {
  return preflight(request);
}

export async function POST(request: Request): Promise<Response> {
  const userId = authenticateDevice(request);
  if (!userId) return json(request, { error: "Unauthorized" }, 401);
  const stt = sttProviderFromEnv();
  const voice = voiceConfigFromEnv();
  if (!stt || !voice) {
    return json(request, { error: "voice is not configured (STT key or GLASSES_LINKED_CHANNEL_ID missing)" }, 503);
  }
  try {
    const pcm = new Uint8Array(await request.arrayBuffer());
    const result = await handleVoiceUpload(
      { stt, utterance: { gateway: glassesChannelGateway, config: voice } },
      pcm,
    );
    return json(request, result);
  } catch (err) {
    if (err instanceof VoiceInputError) return json(request, { error: err.message }, err.httpStatus);
    if (err instanceof UtteranceError) return json(request, { error: err.message }, 400);
    console.error("[glasses] voice failed", err);
    return json(request, { error: "voice failed" }, 502);
  }
}
