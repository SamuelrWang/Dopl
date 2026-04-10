export const QUERY_SYNTHESIS_PROMPT = `You are helping a user find the best AI/automation setups for their needs from a knowledge base.

The user's query:

<query>
{USER_QUERY}
</query>

Here are the most relevant entries found:

<entries>
{RETRIEVED_ENTRIES}
</entries>

Analyze each entry's relevance to the query. For each entry:
1. Explain WHY it's relevant (or not)
2. Rate relevance 1-10
3. Note what parts of the entry apply to the query

Then provide:
- An overall recommendation
- If multiple entries could be combined, explain how
- Any gaps — what the query needs that isn't covered by these entries
- Suggested search terms to find what's missing

Respond in JSON format:
{
  "entries": [
    {
      "entry_id": "...",
      "relevance_score": 8,
      "explanation": "..."
    }
  ],
  "recommendation": "...",
  "composite_approach": "...",
  "gaps": ["..."],
  "suggested_searches": ["..."]
}`;

export function buildQuerySynthesisPrompt(
  query: string,
  entries: string
): string {
  return QUERY_SYNTHESIS_PROMPT.replace("{USER_QUERY}", query).replace(
    "{RETRIEVED_ENTRIES}",
    entries
  );
}
