import { PCM_MAX_BYTES, isNearSilent, pcmToWav, type SttProvider } from "./stt";
import {
  handleGlassesUtterance,
  type UtteranceDeps,
  type UtteranceResult,
} from "./voice-utterance";

/**
 * `POST /api/glasses/device/voice` and the Hey-Even chat-completions shim (both
 * post, then hold up to GLASSES_REPLY_HOLD_MS for a reply), as
 * pure functions over injected STT + channel deps. Routes are thin wrappers.
 */

export type VoiceResponse =
  | { status: "empty"; transcript: string }
  | ({ transcript: string } & UtteranceResult);

export class VoiceInputError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: 400 | 402 | 413,
  ) {
    super(message);
    this.name = "VoiceInputError";
  }
}

/**
 * Read a request body, refusing more than `max` bytes: by `Content-Length`
 * before reading anything, and by counting while streaming (a missing or lying
 * header cannot make the server buffer an unbounded upload).
 */
export async function readCappedBody(request: Request, max: number): Promise<Uint8Array> {
  const tooBig = () => new VoiceInputError(`audio exceeds ${max} bytes (~60s of 16 kHz s16le mono)`, 413);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw tooBig();
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw tooBig();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Voice's first half: size + shape checks, the silence check (no STT, no charge), the meter, STT. */
async function transcribePcm(
  deps: { stt: SttProvider; charge?: () => Promise<string | null> },
  pcm: Uint8Array,
): Promise<{ status: "ok" | "empty"; transcript: string }> {
  if (pcm.byteLength > PCM_MAX_BYTES) {
    throw new VoiceInputError(`audio is ${pcm.byteLength} bytes; max ${PCM_MAX_BYTES} (~60s of 16 kHz s16le mono)`, 413);
  }
  if (pcm.byteLength % 2 !== 0) throw new VoiceInputError("PCM must be whole 16-bit samples", 400);
  if (isNearSilent(pcm)) return { status: "empty", transcript: "" };
  const refusal = deps.charge ? await deps.charge() : null;
  if (refusal) throw new VoiceInputError(refusal, 402);
  const transcript = (await deps.stt.transcribe(pcmToWav(pcm))).trim();
  return transcript ? { status: "ok", transcript } : { status: "empty", transcript: "" };
}

export async function handleVoiceUpload(
  deps: {
    stt: SttProvider;
    utterance: UtteranceDeps;
    /** Meter the utterance (after the silence check, before paid STT): refusal text or null. */
    charge?: () => Promise<string | null>;
  },
  pcm: Uint8Array,
): Promise<VoiceResponse> {
  const heard = await transcribePcm(deps, pcm);
  if (heard.status === "empty") return { status: "empty", transcript: "" };
  return { transcript: heard.transcript, ...(await handleGlassesUtterance(deps.utterance, heard.transcript)) };
}

// ─── Hey Even (OpenAI chat-completions shape) ──────────────────────────────

export const HEY_EVEN_MODEL = "dopl-glasses";

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
  const who =
    result.addressed_name ||
    (result.addressed_to ? `@${result.addressed_to}` : result.channel_name || "your Dopl channel");
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
