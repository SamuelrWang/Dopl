/**
 * POST /api/cluster/name — generate a short 2-4 word name for a cluster
 * of panels based on their titles / summaries / tags.
 *
 * Called once on cluster creation (non-blocking — the UI shows a
 * placeholder "Cluster N" name until this resolves). If Claude fails or
 * times out, returns 500 and the client keeps the placeholder.
 *
 * Request body:
 *   {
 *     panels: Array<{
 *       type: string;
 *       title?: string;
 *       summary?: string;
 *       useCase?: string;
 *       tags?: string[];
 *     }>
 *   }
 *
 * Response body:
 *   { name: string }  // 2-4 words, no quotes, no trailing punctuation
 */

import { NextRequest } from "next/server";
import { callClaude } from "@/lib/ai";
import { withExternalAuth } from "@/lib/auth/with-auth";

export const dynamic = "force-dynamic";

interface ClusterNamePanel {
  type: string;
  title?: string;
  summary?: string;
  useCase?: string;
  tags?: string[];
}

const SYSTEM_PROMPT = `You name clusters of AI/automation setup panels. Generate a SHORT, descriptive name for the cluster based on its member panels.

RULES:
- 2–4 words only
- Title Case
- No quotes, no trailing punctuation, no explanations
- No generic filler like "Cluster" / "Group" / "Panels"
- Describe the shared theme (e.g. "Email Automation", "RAG Research", "Lead Gen Stack")
- If the panels are clearly unrelated, pick the most prominent theme

Return ONLY the name. Nothing else.`;

function summarisePanels(panels: ClusterNamePanel[]): string {
  // Build a compact one-line-per-panel summary for Claude. Keep it short
  // so the round-trip is fast.
  const lines: string[] = [];
  for (const p of panels) {
    const bits: string[] = [`[${p.type}]`];
    if (p.title) bits.push(p.title.slice(0, 80));
    if (p.summary) bits.push(`— ${p.summary.slice(0, 120)}`);
    if (p.useCase) bits.push(`(${p.useCase})`);
    if (p.tags && p.tags.length > 0)
      bits.push(`tags: ${p.tags.slice(0, 5).join(", ")}`);
    lines.push(bits.join(" "));
  }
  return lines.join("\n");
}

/** Trim quotes, trailing punctuation, and enforce a short length. */
function sanitiseName(raw: string): string {
  let name = raw.trim();
  // Strip wrapping quotes (single or double) if Claude used them.
  name = name.replace(/^["'`]+|["'`]+$/g, "").trim();
  // Drop trailing punctuation.
  name = name.replace(/[.!?,;:]+$/, "").trim();
  // Hard cap — 40 chars is plenty for a 2-4 word name.
  if (name.length > 40) name = name.slice(0, 40).trim();
  return name;
}

async function handlePost(request: NextRequest) {
  try {
    const body = await request.json();
    const panels: ClusterNamePanel[] = Array.isArray(body.panels)
      ? body.panels
      : [];

    if (panels.length === 0) {
      return Response.json(
        { error: "panels array is required and must not be empty" },
        { status: 400 }
      );
    }

    const userContent = `Generate a name for this cluster:\n\n${summarisePanels(panels)}`;
    const raw = await callClaude(SYSTEM_PROMPT, userContent, {
      maxTokens: 32,
    });
    const name = sanitiseName(raw);

    if (!name) {
      return Response.json(
        { error: "empty name from model" },
        { status: 500 }
      );
    }

    return Response.json({ name });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = withExternalAuth(handlePost);
