import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { nowOf } from "../../core/clock";
import { hashCredential, mintCredential } from "../../core/devices/credentials";
import { deviceNotFound } from "../../core/devices/service";
import type { DeviceStore, GlassesDevice } from "../../core/devices/types";
import { bearerOf, corsHeaders, json } from "../../core/http";
import { resolveDeviceDeps } from "../../core/messages/device-handlers";
import { isUuid } from "../../core/validation";
import { LIMITED, NO_TARGET, utteranceDepsFor, type VoiceHandlerDeps } from "../../core/voice/handlers";
import { UtteranceError, handleGlassesUtterance, type UtteranceResult } from "../../core/voice/utterance";

/**
 * Hey Even: the Even app's assistant can call a custom agent over the OpenAI
 * chat-completions shape. Each device gets its own key (`/api/glasses/hey-even*`,
 * minted by `rotateKey`); an utterance posts like push-to-talk, to the same target.
 */

const HEY_EVEN_MODEL = "dopl-glasses";
const COMPLETIONS_PATH = "/api/glasses/hey-even/v1/chat/completions";
const mintHeyEvenKey = () => mintCredential("glshe_");

type ChatMessage = { role?: unknown; content?: unknown };

/** The last `user` message's text; content may be a string or text parts. */
export function lastUserText(body: unknown): string | null {
  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as ChatMessage;
    if (m?.role !== "user") continue;
    if (typeof m.content === "string") return m.content.trim() || null;
    if (Array.isArray(m.content)) {
      const text = m.content
        .map((p) => (p && typeof p === "object" && (p as { type?: unknown }).type === "text" ? String((p as { text?: unknown }).text ?? "") : ""))
        .join(" ")
        .trim();
      return text || null;
    }
    return null;
  }
  return null;
}

export function assistantText(result: UtteranceResult): string {
  if (result.status === "replied" && result.reply) return result.reply;
  const who = result.addressed_name || (result.addressed_to ? `@${result.addressed_to}` : result.channel_name || "your Dopl channel");
  if (result.status === "offline") return `Sent to ${who}. No agent is running there right now.`;
  return `Sent to ${who}.`;
}

export function chatCompletion(content: string, id: string, created: number) {
  return {
    id,
    object: "chat.completion",
    created,
    model: HEY_EVEN_MODEL,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

/** Minimal streaming: one content chunk, one finish chunk, `[DONE]`. */
export function chatCompletionStream(content: string, id: string, created: number): string {
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model: HEY_EVEN_MODEL,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  return chunk({ role: "assistant", content }, null) + chunk({}, "stop") + "data: [DONE]\n\n";
}

export function modelList(created: number) {
  return { object: "list", data: [{ id: HEY_EVEN_MODEL, object: "model", created, owned_by: "dopl" }] };
}

/** Request headers for the log, with every credential-bearing value redacted. */
export function redactedHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = /authorization|cookie|api-key|token/i.test(key) ? "[redacted]" : value;
  });
  return out;
}

/**
 * The public base a Hey Even URL is built on. `GLASSES_API_BASE_URL` first (the
 * canonical host: `NEXT_PUBLIC_APP_URL` is the apex, which 307s to www, and
 * clients drop `Authorization` across that redirect), then `NEXT_PUBLIC_APP_URL`
 * in production, else the server's own origin. Never a request header: a
 * spoofed `X-Forwarded-Host` must not steer where a user sends their key.
 */
export function heyEvenBaseUrl(request: Request, env: Record<string, string | undefined> = process.env): string {
  const configured = env.GLASSES_API_BASE_URL || (env.NODE_ENV === "production" ? env.NEXT_PUBLIC_APP_URL : "");
  return (configured || new URL(request.url).origin).replace(/\/+$/, "");
}

async function deviceFromHeyEvenKey(store: DeviceStore, request: Request): Promise<GlassesDevice | null> {
  const key = bearerOf(request);
  return key ? store.findDeviceByAssistantKeyHash(hashCredential(key)) : null;
}

const oaiError = (request: Request, message: string, type: string, status: number, extra: Record<string, string> = {}) =>
  json(request, { error: { message, type } }, status, extra);

export function createHeyEvenHandlers(input: VoiceHandlerDeps & { debug?: boolean }) {
  const deps = resolveDeviceDeps(input);
  const createdNow = () => Math.floor(nowOf(deps) / 1000);
  return {
    async completions(request: Request): Promise<Response> {
      if (deps.debug) {
        console.log("[glasses] hey-even request", new URL(request.url).pathname, JSON.stringify(redactedHeaders(request.headers)));
      }
      const device = await deviceFromHeyEvenKey(deps.devices, request);
      if (!device) return oaiError(request, "Unauthorized", "invalid_request_error", 401);
      const utterance = await utteranceDepsFor(deps, device, request);
      if (!utterance) return oaiError(request, NO_TARGET, "invalid_request_error", 409);
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
        if ((body as { stream?: unknown }).stream === true) {
          return new Response(chatCompletionStream(content, id, createdNow()), {
            headers: { ...corsHeaders(request), "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
          });
        }
        return json(request, chatCompletion(content, id, createdNow()));
      } catch (err) {
        if (err instanceof UtteranceError) return oaiError(request, err.message, "invalid_request_error", 400);
        console.error("[glasses] hey-even failed", err);
        return oaiError(request, "failed to reach your Dopl channel", "server_error", 502);
      }
    },

    async models(request: Request): Promise<Response> {
      const device = await deviceFromHeyEvenKey(deps.devices, request);
      if (!device) return oaiError(request, "Unauthorized", "invalid_request_error", 401);
      return json(request, modelList(createdNow()));
    },

    /** Signed-in user: a fresh key for one device, returned once; rotating revokes the previous key. */
    async rotateKey(request: Request, userId: string, deviceId: string): Promise<Response> {
      try {
        if (!isUuid(deviceId)) throw deviceNotFound();
        const key = mintHeyEvenKey();
        if (!(await deps.devices.setAssistantKeyHash(userId, deviceId, hashCredential(key)))) throw deviceNotFound();
        const url = `${heyEvenBaseUrl(request)}${COMPLETIONS_PATH}`;
        return NextResponse.json({ key, url }, { headers: { "Cache-Control": "no-store" } });
      } catch (err) {
        return toHttpErrorResponse("glasses", err);
      }
    },
  };
}
