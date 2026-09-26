import { randomUUID } from "node:crypto";
import { corsHeaders, json } from "./cors";
import { authedDevice, resolveDeviceDeps, type DeviceHandlerDeps } from "./device-handlers";
import { deviceFromHeyEvenKey } from "./devices-service";
import type { GlassesDevice } from "./devices-types";
import { PCM_MAX_BYTES, type SttProvider } from "./stt";
import {
  VoiceInputError,
  assistantText,
  chatCompletion,
  chatCompletionStream,
  handleVoiceUpload,
  lastUserText,
  readCappedBody,
  modelList,
  redactedHeaders,
} from "./voice";
import { UtteranceError, handleGlassesUtterance, voiceConfigForDevice, type UtteranceDeps } from "./voice-utterance";

/**
 * Voice-facing handlers: push-to-talk (`/api/glasses/device/voice`, device
 * token) and the Hey Even chat-completions shim (`/api/glasses/hey-even*`,
 * per-device Hey Even key). Both post into the DEVICE's linked channel as the
 * device OWNER; an unlinked device gets 409.
 */

export interface VoiceHandlerDeps extends DeviceHandlerDeps {
  stt: () => SttProvider | null;
  holdMs?: number;
  /** Per-device utterance limiter (voice + Hey Even share it); true = within the limit. */
  allowUtterance: (deviceId: string) => Promise<boolean>;
  /**
   * Meter one utterance for the device owner: refusal text, or null to proceed.
   * An utterance is charged like one glasses MCP tool call (one credit), because
   * it does the same work — a post into a channel — plus STT for voice.
   */
  chargeUtterance: (userId: string) => Promise<string | null>;
  /** Log Hey Even request headers (credentials redacted); off unless GLASSES_DEBUG=1. */
  debug?: boolean;
}

export const UTTERANCE_RPM = 20;
const NOT_LINKED = "This device is not linked to a channel. Link one in Dopl settings → Glasses.";
const LIMITED = "Too many voice requests from this device; try again in a minute.";

function utteranceDeps(deps: VoiceHandlerDeps, device: GlassesDevice): UtteranceDeps | null {
  const config = voiceConfigForDevice(device);
  return config ? { gateway: deps.gateway, config, now: deps.now, sleep: deps.sleep, holdMs: deps.holdMs } : null;
}

const oaiError = (request: Request, message: string, type: string, status: number, extra: Record<string, string> = {}) =>
  json(request, { error: { message, type } }, status, extra);

export function createVoiceHandlers(input: VoiceHandlerDeps) {
  const deps = resolveDeviceDeps(input);
  return {
    async voice(request: Request): Promise<Response> {
      const device = await authedDevice(deps, request);
      if (!device) return json(request, { error: "Unauthorized" }, 401);
      const utterance = utteranceDeps(deps, device);
      if (!utterance) return json(request, { error: NOT_LINKED }, 409);
      const stt = deps.stt();
      if (!stt) return json(request, { error: "Speech-to-text is not configured on this server." }, 503);
      try {
        if (!(await deps.allowUtterance(device.id))) return json(request, { error: LIMITED }, 429, { "Retry-After": "60" });
        const pcm = await readCappedBody(request, PCM_MAX_BYTES);
        const charge = () => deps.chargeUtterance(device.user_id);
        return json(request, await handleVoiceUpload({ stt, utterance, charge }, pcm));
      } catch (err) {
        if (err instanceof VoiceInputError) return json(request, { error: err.message }, err.httpStatus);
        if (err instanceof UtteranceError) return json(request, { error: err.message }, 400);
        console.error("[glasses] voice failed", err);
        return json(request, { error: "voice failed" }, 502);
      }
    },

    async heyEven(request: Request): Promise<Response> {
      if (deps.debug) {
        console.log("[glasses] hey-even request", new URL(request.url).pathname, JSON.stringify(redactedHeaders(request.headers)));
      }
      const device = await deviceFromHeyEvenKey(deps.devices, request);
      if (!device) return oaiError(request, "Unauthorized", "invalid_request_error", 401);
      const utterance = utteranceDeps(deps, device);
      if (!utterance) return oaiError(request, NOT_LINKED, "invalid_request_error", 409);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return oaiError(request, "body must be JSON", "invalid_request_error", 400);
      }
      const text = lastUserText(body);
      if (!text) return oaiError(request, "no user message", "invalid_request_error", 400);
      if (!(await deps.allowUtterance(device.id))) {
        return oaiError(request, LIMITED, "rate_limit_error", 429, { "Retry-After": "60" });
      }
      const refusal = await deps.chargeUtterance(device.user_id);
      if (refusal) return oaiError(request, refusal, "insufficient_quota", 402);
      try {
        const content = assistantText(await handleGlassesUtterance(utterance, text));
        const id = `chatcmpl-${randomUUID()}`;
        const created = Math.floor((deps.now ?? Date.now)() / 1000);
        if ((body as { stream?: unknown }).stream === true) {
          return new Response(chatCompletionStream(content, id, created), {
            headers: { ...corsHeaders(request), "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
          });
        }
        return json(request, chatCompletion(content, id, created));
      } catch (err) {
        if (err instanceof UtteranceError) return oaiError(request, err.message, "invalid_request_error", 400);
        console.error("[glasses] hey-even failed", err);
        return oaiError(request, "failed to reach your Dopl channel", "server_error", 502);
      }
    },

    async models(request: Request): Promise<Response> {
      const device = await deviceFromHeyEvenKey(deps.devices, request);
      if (!device) return oaiError(request, "Unauthorized", "invalid_request_error", 401);
      return json(request, modelList(Math.floor((deps.now ?? Date.now)() / 1000)));
    },
  };
}
