import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "dotenv";
import { resolve } from "path";
import { retryWithBackoff } from "@/features/ingestion/server/utils";
import { callExternal } from "@/lib/analytics/call-external";
import { logSystemEvent } from "@/lib/analytics/system-events";

// Force-load .env.local with override.
// Next.js doesn't override shell env vars (even empty ones) with .env.local values.
// This ensures our keys are always loaded correctly regardless of shell state.
config({ path: resolve(process.cwd(), ".env.local"), override: true });

let _claude: Anthropic | null = null;
let _openai: OpenAI | null = null;

function getClaudeClient(): Anthropic {
  if (!_claude) {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) {
      throw new Error("ANTHROPIC_API_KEY environment variable is not set or empty");
    }
    _claude = new Anthropic({ apiKey: key });
  }
  return _claude;
}

function getOpenAIClient(): OpenAI {
  if (!_openai) {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) {
      throw new Error("OPENAI_API_KEY environment variable is not set or empty");
    }
    _openai = new OpenAI({ apiKey: key });
  }
  return _openai;
}

// Exported for direct use in image extractor
export const claude = new Proxy({} as Anthropic, {
  get(_target, prop) {
    return Reflect.get(getClaudeClient(), prop);
  },
});

// text-embedding-3-small caps input at 8192 tokens. Using ~3 chars/token
// as a conservative lower bound, 24000 chars is a safe ceiling. This is
// a last-line defense — the embedder's splitIntoChunks is supposed to
// keep chunks below this, but truncate-with-warning beats a hard 400
// when an upstream caller slips through.
const MAX_EMBEDDING_INPUT_CHARS = 24_000;

export async function generateEmbedding(text: string): Promise<number[]> {
  let input = text;
  if (input.length > MAX_EMBEDDING_INPUT_CHARS) {
    const original = input.length;
    input = input.slice(0, MAX_EMBEDDING_INPUT_CHARS);
    console.warn(
      `[generateEmbedding] Truncated input from ${original} to ${MAX_EMBEDDING_INPUT_CHARS} chars`
    );
    void logSystemEvent({
      severity: "warn",
      category: "ingestion",
      source: "ai.generateEmbedding",
      message: `Embedding input truncated (${original} → ${MAX_EMBEDDING_INPUT_CHARS} chars)`,
      fingerprintKeys: ["embedding", "truncated"],
      metadata: { original_chars: original, truncated_chars: MAX_EMBEDDING_INPUT_CHARS },
    });
  }

  const client = getOpenAIClient();
  const response = await callExternal(
    "openai.embeddings",
    () =>
      retryWithBackoff(
        () =>
          client.embeddings.create({
            model: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
            input,
          }),
        { label: "generateEmbedding" }
      ),
    { slowMs: 10_000 }
  );
  return response.data[0].embedding;
}

export type ModelTier = "haiku" | "sonnet";

const MODEL_IDS: Record<ModelTier, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-20250514",
};

export async function callClaude(
  systemPrompt: string,
  userContent: string,
  options?: { maxTokens?: number; model?: ModelTier }
): Promise<string> {
  if (!userContent || userContent.trim().length === 0) {
    return "";
  }

  const client = getClaudeClient();
  const modelId = options?.model
    ? MODEL_IDS[options.model]
    : (process.env.LLM_MODEL || MODEL_IDS.sonnet);

  const response = await callExternal(
    `anthropic.messages[${options?.model || "default"}]`,
    () =>
      retryWithBackoff(
        () =>
          client.messages.create({
            model: modelId,
            max_tokens: options?.maxTokens || 8192,
            ...(systemPrompt ? { system: systemPrompt } : {}),
            messages: [{ role: "user" as const, content: userContent }],
          }),
        { label: `callClaude[${options?.model || "default"}]` }
      ),
    { slowMs: 60_000, metadata: { model: modelId } }
  );

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.text || "";
}
