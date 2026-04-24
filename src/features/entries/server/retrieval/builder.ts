import { buildBuilderPrompt } from "@/shared/prompts/builder";
import { searchEntries } from "./search";
import type { BuildBundle } from "@/types/api";

/**
 * Build a composite-solution bundle the agent runs in its own context.
 *
 * Retrieval (embedding-based search) stays server-side — it's cheap, has
 * no LLM spend, and needs pgvector. The synthesis itself (reading the
 * retrieved entries and producing composite README + agents.md) is the
 * agent's job now: we hand back the ready-to-run prompt, the retrieved
 * entries, and step-by-step instructions.
 */
export async function buildBuilderBundle(
  brief: string,
  constraints?: {
    preferred_tools?: string[];
    excluded_tools?: string[];
    max_complexity?: string;
    budget_context?: string;
  },
  callerUserId?: string
): Promise<BuildBundle> {
  // 1. Retrieval — embedding search against the KB. callerUserId gates
  //    non-approved entries out of the bundle (same rationale as /api/query).
  const results = await searchEntries(brief, {
    maxResults: 10,
    threshold: 0.5, // Lower threshold to surface more diverse candidates.
    callerUserId,
  });

  if (results.length === 0) {
    return {
      status: "no_matches",
      brief,
      constraints: constraints ?? null,
      entries: [],
      prompt: "",
      instructions:
        "No entries in the knowledge base matched this brief. Tell the user the KB doesn't have relevant prior art yet; suggest ingesting a few URLs (via `prepare_ingest`) related to the brief, then retry `build_solution`.",
    };
  }

  // 2. Assemble entries for the prompt body. Preserve full readme +
  //    agents.md content since the agent's context is the one doing the
  //    synthesis — no server-side truncation needed beyond what the
  //    embedder already capped entries at.
  const entriesStr = results
    .map(
      (r) =>
        `Entry ID: ${r.entry_id}\nSlug: ${r.slug ?? "(no slug)"}\nTitle: ${r.title}\nREADME:\n${r.readme || "N/A"}\nagents.md:\n${r.agents_md || "N/A"}\nManifest:\n${JSON.stringify(r.manifest, null, 2)}`
    )
    .join("\n\n===\n\n");

  const constraintsStr = constraints
    ? JSON.stringify(constraints, null, 2)
    : "None specified";

  const prompt = buildBuilderPrompt(brief, constraintsStr, entriesStr);

  // 3. Return the agent-facing bundle. NO callClaude — the agent runs
  //    `prompt` in its own context and uses the JSON output to respond
  //    to the user. Nothing is persisted; build_solution is stateless.
  return {
    status: "ready",
    brief,
    constraints: constraints ?? null,
    entries: results.map((r) => ({
      entry_id: r.entry_id,
      slug: r.slug,
      title: r.title,
      similarity: r.similarity,
    })),
    prompt,
    instructions: [
      "Run the `prompt` field against your own model context.",
      "The prompt expects JSON output: `{ composite_readme, composite_agents_md, source_attribution, confidence }`.",
      "Present the composite README + agents.md to the user in your reply. Link each source entry with its public URL (derive from slug: `<host>/e/<slug>`).",
      "Nothing is persisted server-side — this is a synthesis-only tool. If the user wants the composite saved as a new KB entry, run `prepare_ingest` on the final artifacts separately.",
    ].join(" "),
  };
}
