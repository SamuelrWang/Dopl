import "server-only";
import { randomUUID } from "node:crypto";
import { authenticateDevice, corsHeaders, json } from "./device";
import {
  assistantText,
  chatCompletion,
  chatCompletionStream,
  lastUserText,
  redactedHeaders,
} from "./voice";
import { glassesChannelGateway } from "./voice-channel";
import { UtteranceError, handleGlassesUtterance, voiceConfigFromEnv } from "./voice-utterance";

/**
 * The Hey Even chat-completions shim, shared by `/api/glasses/hey-even` and
 * `/api/glasses/hey-even/v1/chat/completions`. It logs every request's headers
 * (credentials redacted) so a real-glasses run shows what the Even app sends.
 */
export async function heyEvenPost(request: Request): Promise<Response> {
  console.log("[glasses] hey-even request", request.method, new URL(request.url).pathname, JSON.stringify(redactedHeaders(request.headers)));
  const userId = authenticateDevice(request);
  if (!userId) return json(request, { error: { message: "Unauthorized", type: "invalid_request_error" } }, 401);
  const voice = voiceConfigFromEnv();
  if (!voice) return json(request, { error: { message: "GLASSES_LINKED_CHANNEL_ID is not set", type: "server_error" } }, 503);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(request, { error: { message: "body must be JSON", type: "invalid_request_error" } }, 400);
  }
  const text = lastUserText(body);
  if (!text) return json(request, { error: { message: "no user message", type: "invalid_request_error" } }, 400);
  try {
    const result = await handleGlassesUtterance({ gateway: glassesChannelGateway, config: voice }, text);
    const content = assistantText(result);
    const id = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    if ((body as { stream?: unknown }).stream === true) {
      return new Response(chatCompletionStream(content, id, created), {
        headers: { ...corsHeaders(request), "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
      });
    }
    return json(request, chatCompletion(content, id, created));
  } catch (err) {
    if (err instanceof UtteranceError) {
      return json(request, { error: { message: err.message, type: "invalid_request_error" } }, 400);
    }
    console.error("[glasses] hey-even failed", err);
    return json(request, { error: { message: "failed to reach your Dopl channel", type: "server_error" } }, 502);
  }
}
