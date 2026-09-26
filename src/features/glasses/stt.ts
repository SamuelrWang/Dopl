/**
 * Speech-to-text for the glasses push-to-talk. The device uploads raw PCM
 * (signed 16-bit little-endian, 16 kHz, mono); it is wrapped as a WAV here and
 * sent to the configured provider: the first key present of `OPENAI_API_KEY`
 * (`gpt-4o-mini-transcribe`) and `GROQ_API_KEY` (`whisper-large-v3`). No other
 * provider is implemented.
 */

export const PCM_SAMPLE_RATE = 16_000;
/** ~60s of 16 kHz s16le mono. */
export const PCM_MAX_BYTES = PCM_SAMPLE_RATE * 2 * 62;
/** Shorter than this is a stray tap, not speech. */
const MIN_SPEECH_MS = 300;
/** RMS below this (of 32768) is treated as silence. */
const SILENCE_RMS = 150;

export function pcmToWav(pcm: Uint8Array, sampleRate = PCM_SAMPLE_RATE): Uint8Array {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const ascii = (off: number, s: string) => [...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, 36 + pcm.byteLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, pcm.byteLength, true);
  const out = new Uint8Array(44 + pcm.byteLength);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

export function pcmStats(pcm: Uint8Array): { durationMs: number; rms: number } {
  const samples = Math.floor(pcm.byteLength / 2);
  const view = new DataView(pcm.buffer, pcm.byteOffset, samples * 2);
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const s = view.getInt16(i * 2, true);
    sum += s * s;
  }
  return {
    durationMs: (samples / PCM_SAMPLE_RATE) * 1000,
    rms: samples ? Math.sqrt(sum / samples) : 0,
  };
}

export function isNearSilent(pcm: Uint8Array): boolean {
  const { durationMs, rms } = pcmStats(pcm);
  return durationMs < MIN_SPEECH_MS || rms < SILENCE_RMS;
}

export interface SttProvider {
  name: string;
  transcribe(wav: Uint8Array): Promise<string>;
}

function whisperCompatible(name: string, url: string, key: string, model: string): SttProvider {
  return {
    name,
    async transcribe(wav) {
      const form = new FormData();
      form.append("file", new Blob([wav as BlobPart], { type: "audio/wav" }), "utterance.wav");
      form.append("model", model);
      form.append("response_format", "json");
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        throw new Error(`${name} transcription failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      }
      const json = (await res.json()) as { text?: unknown };
      return typeof json.text === "string" ? json.text.trim() : "";
    },
  };
}

export function sttProviderFromEnv(env: Record<string, string | undefined> = process.env): SttProvider | null {
  if (env.OPENAI_API_KEY) {
    return whisperCompatible(
      "openai:gpt-4o-mini-transcribe",
      "https://api.openai.com/v1/audio/transcriptions",
      env.OPENAI_API_KEY,
      "gpt-4o-mini-transcribe",
    );
  }
  if (env.GROQ_API_KEY) {
    return whisperCompatible(
      "groq:whisper-large-v3",
      "https://api.groq.com/openai/v1/audio/transcriptions",
      env.GROQ_API_KEY,
      "whisper-large-v3",
    );
  }
  return null;
}
