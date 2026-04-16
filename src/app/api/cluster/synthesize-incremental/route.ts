/**
 * POST /api/cluster/synthesize-incremental — merge a single new entry's
 * agents.md into existing cluster brain instructions.
 *
 * Request body:
 *   {
 *     existing_instructions: string,
 *     new_entry: { title: string; agents_md: string; readme: string }
 *   }
 *
 * Response body:
 *   { instructions: string }
 */

import { NextRequest } from "next/server";
import { callClaude } from "@/lib/ai";
import { withMcpCredits } from "@/lib/auth/with-auth";

export const dynamic = "force-dynamic";

const SYSTEM_PROMPT =
  "You have existing synthesized instructions for an AI/automation cluster. A new entry is being added. " +
  "Integrate the new entry's setup steps into the existing instructions without redundancy. " +
  "Preserve ALL existing content — do not remove or condense anything already there. " +
  "Add new sections or merge into existing sections as appropriate. " +
  "Use markdown formatting. Output ONLY the complete updated instructions, nothing else.";

async function handlePost(request: NextRequest) {
  try {
    const body = await request.json();
    const { existing_instructions, new_entry } = body;

    if (!existing_instructions || typeof existing_instructions !== "string") {
      return Response.json(
        { error: "existing_instructions (string) is required" },
        { status: 400 }
      );
    }

    if (!new_entry || !new_entry.agents_md) {
      return Response.json(
        { error: "new_entry with agents_md is required" },
        { status: 400 }
      );
    }

    // Budget: existing instructions get full inclusion, new entry gets 8000 chars
    const newAgentsMd = (new_entry.agents_md || "").slice(0, 8000);
    const newReadme = (new_entry.readme || "").slice(0, 800);

    const userContent =
      `## Existing cluster instructions\n\n${existing_instructions}\n\n---\n\n` +
      `## New entry to integrate: ${new_entry.title || "Untitled"}\n\n` +
      `### agents.md\n${newAgentsMd}\n\n` +
      `### Additional context from README\n${newReadme}`;

    const result = await callClaude(SYSTEM_PROMPT, userContent, {
      maxTokens: 8192,
    });

    return Response.json({ instructions: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = withMcpCredits("mcp_synthesize", handlePost);
