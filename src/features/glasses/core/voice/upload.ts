import { PCM_MAX_BYTES, isNearSilent, pcmToWav, type SttProvider } from "./stt";
import { handleGlassesUtterance, type UtteranceDeps, type UtteranceResult } from "./utterance";

/** Push-to-talk (`POST /api/glasses/device/voice`): PCM → STT → the channel, pure over injected deps. */

type VoiceResponse =
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
