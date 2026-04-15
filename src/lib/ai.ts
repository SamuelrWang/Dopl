import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "dotenv";
import { resolve } from "path";
import { retryWithBackoff } from "@/lib/ingestion/utils";

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

export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getOpenAIClient();
  const response = await retryWithBackoff(
    () =>
      client.embeddings.create({
        model: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
        input: text,
      }),
    { label: "generateEmbedding" }
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

  const response = await retryWithBackoff(
    () =>
      client.messages.create({
        model: modelId,
        max_tokens: options?.maxTokens || 8192,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages: [{ role: "user" as const, content: userContent }],
      }),
    { label: `callClaude[${options?.model || "default"}]` }
  );

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.text || "";
}
