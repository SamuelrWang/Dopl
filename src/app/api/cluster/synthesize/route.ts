/**
 * POST /api/cluster/synthesize — synthesize a unified agents.md instruction
 * document from multiple entry data payloads.
 *
 * Request body:
 *   {
 *     entries: Array<{ title: string; agents_md: string; readme: string }>
 *   }
 *
 * Response body:
 *   { instructions: string }
 */

import { NextRequest } from "next/server";
import { callClaude } from "@/lib/ai";
import { withExternalAuth } from "@/lib/auth/with-auth";

export const dynamic = "force-dynamic";

const SYSTEM_PROMPT =
  "You are synthesizing multiple AI/automation setup instructions into a single unified playbook. " +
  "Merge the individual agents.md files into one coherent document. Preserve all actionable steps " +
  "but eliminate redundancy. Group by workflow phase. Use markdown formatting. " +
  "Output ONLY the synthesized instructions, nothing else.";

async function handlePost(request: NextRequest) {
  try {
    const body = await request.json();
    const entries: Array<{ title: string; agents_md: string; readme: string }> =
      Array.isArray(body.entries) ? body.entries : [];

    if (entries.length === 0) {
      return Response.json(
        { error: "entries array is required and must not be empty" },
        { status: 400 }
      );
    }

    // Budget: ~8000 chars per entry to stay within context limits
    const perEntryBudget = Math.min(8000, Math.floor(80000 / Math.max(entries.length, 1)));
    const readmeBudget = Math.min(800, Math.floor(perEntryBudget * 0.1));
    const agentsBudget = perEntryBudget - readmeBudget;

    const userContent = entries
      .map((entry) => {
        const agentsMd = (entry.agents_md || "").slice(0, agentsBudget);
        const readme = (entry.readme || "").slice(0, readmeBudget);
        return (
          `## ${entry.title}\n\n${agentsMd}\n\n` +
          `### Additional context from README:\n${readme}`
        );
      })
      .join("\n\n---\n\n");

    const result = await callClaude(SYSTEM_PROMPT, userContent, {
      maxTokens: 4096,
    });

    return Response.json({ instructions: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = withExternalAuth(handlePost);
