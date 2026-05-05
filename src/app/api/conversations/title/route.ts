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

const SYSTEM =
  "Generate a concise 3-6 word title summarizing this conversation. Return only the title text — no quotes, no surrounding punctuation, no 'Title:' prefix, no markdown.";

const TITLE_MODEL = "claude-haiku-4-5-20251001";

export const POST = withWorkspaceAuth(async (request) => {
  const { messages } = await parseJson(request, BodySchema);

  const transcript = messages
    .filter((m) => m.type === "text" && typeof m.content === "string")
    .map((m) => `${m.role}: ${(m.content as string).slice(0, 600)}`)
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
    max_tokens: 50,
    system: SYSTEM,
    messages: [{ role: "user", content: transcript }],
  });

  const block = res.content[0];
  const raw = block && block.type === "text" ? block.text : "";
  const title = raw
    .trim()
    .replace(/^["'\s]+/, "")
    .replace(/["'\s.!?]+$/, "")
    .slice(0, 80);
  if (!title) {
    throw new HttpError(502, "EMPTY_TITLE", "Model returned empty title");
  }

  return NextResponse.json({ title });
});
