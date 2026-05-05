import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";

const BodySchema = z.object({
  messages: z
    .array(
      z
        .object({
          role: z.string(),
          type: z.string(),
          content: z.string().optional(),
        })
        .passthrough()
    )
    .min(1)
    .max(20),
});

const SYSTEM = `You name conversations. Output ONLY a short topic title for the conversation below.

Rules:
- 3 to 6 words. Maximum 40 characters.
- A noun phrase describing the topic, NOT a sentence.
- Do NOT echo the user's question or the assistant's answer.
- Do NOT include quotes, punctuation, "Title:" prefixes, or markdown.

Good examples:
  Polymarket trading bot setup
  React build error fix
  Workspace auth question
  Canvas access limitation

Bad examples (do not do this):
  "I don't have access to your canvas"  (echoes the answer; sentence)
  How do I build a bot?  (sentence with punctuation)
  Title: My new project  (has prefix)`;

const TITLE_MODEL = "claude-haiku-4-5-20251001";
const MAX_WORDS = 6;
const MAX_CHARS = 40;

export const POST = withWorkspaceAuth(async (request) => {
  const { messages } = await parseJson(request, BodySchema);

  const transcript = messages
    .filter((m) => m.type === "text" && typeof m.content === "string")
    .map((m) => {
      const speaker = m.role === "user" ? "User" : "Assistant";
      return `${speaker}: ${(m.content as string).slice(0, 600)}`;
    })
    .join("\n\n");
  if (!transcript) {
    throw new HttpError(
      400,
      "EMPTY_TRANSCRIPT",
      "No textual messages to summarize"
    );
  }

  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    throw new HttpError(
      500,
      "ANTHROPIC_KEY_MISSING",
      "ANTHROPIC_API_KEY not configured"
    );
  }

  const client = new Anthropic({ apiKey: key });
  const res = await client.messages.create({
    model: TITLE_MODEL,
    max_tokens: 20,
    system: SYSTEM,
    messages: [{ role: "user", content: transcript }],
  });

  const block = res.content[0];
  const raw = block && block.type === "text" ? block.text : "";

  // Strip wrapping quotes / leading "Title:" / trailing punctuation,
  // then enforce the word + char caps. If the model still ignores the
  // constraints (returns a sentence), 502 — the client falls back to
  // leaving the title as "New chat" rather than persisting garbage.
  const cleaned = raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^title[:\-\s]+/i, "")
    .replace(/[.!?,;:]+$/g, "")
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
  const title = words.join(" ").slice(0, MAX_CHARS).trim();

  if (!title || title.length < 2) {
    throw new HttpError(502, "EMPTY_TITLE", "Model returned empty title");
  }

  return NextResponse.json({ title });
});
