/**
 * POST /api/chat/name — generate a short topic name for a chat conversation.
 *
 * Request body:
 *   { messages: Array<{ role: "user" | "assistant", content: string }> }
 *
 * Response body:
 *   { name: string }  // 2-5 words, natural casing
 */

import { NextRequest } from "next/server";
import { callClaude } from "@/lib/ai";
import { withMcpCredits } from "@/lib/auth/with-auth";

export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `You generate short topic names for chat conversations. Given the first few messages of a conversation, generate a concise descriptive name.

RULES:
- 2–5 words only
- Natural casing (e.g. "Email automation setup", "RAG pipeline debugging", "n8n webhook config")
- No quotes, no trailing punctuation, no explanations
- Describe the topic, not the action ("Claude API integration" not "Asking about Claude API")
- Be specific, not generic ("Supabase auth setup" not "Database question")

Return ONLY the name. Nothing else.`;

function sanitizeName(raw: string): string {
  let name = raw.trim();
  // Strip wrapping quotes
  name = name.replace(/^["'`]+|["'`]+$/g, "").trim();
  // Drop trailing punctuation
  name = name.replace(/[.!?,;:]+$/, "").trim();
  // Cap length
  if (name.length > 50) name = name.slice(0, 50).trim();
  return name;
}

async function handlePost(request: NextRequest) {
  try {
    const body = await request.json();
    const messages: Array<{ role: string; content: string }> =
      Array.isArray(body.messages) ? body.messages : [];

    if (messages.length === 0) {
      return Response.json(
        { error: "messages array is required" },
        { status: 400 }
      );
    }

    // Build a compact transcript from the first few messages
    const transcript = messages
      .slice(0, 4)
      .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
      .join("\n");

    const raw = await callClaude(
      SYSTEM_PROMPT,
      `Generate a topic name for this conversation:\n\n${transcript}`,
      { maxTokens: 32 }
    );
    const name = sanitizeName(raw);

    if (!name) {
      return Response.json({ error: "empty name from model" }, { status: 500 });
    }

    return Response.json({ name });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

// UI (session) auth skips credit charges; API-key callers are charged.
export const POST = withMcpCredits("mcp_list", handlePost);
