import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { searchEntries } from "@/lib/retrieval/search";
import { supabase } from "@/lib/supabase";
import { BUILDER_CHAT_SYSTEM_PROMPT } from "@/lib/prompts/chat-system";
import { config } from "dotenv";
import { resolve } from "path";

// Force-load env (same pattern as ai.ts)
config({ path: resolve(process.cwd(), ".env.local"), override: true });

export const dynamic = "force-dynamic";

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_knowledge_base",
    description:
      "Search the Setup Intelligence Engine knowledge base for AI/automation setups matching a query. Returns ranked results with titles, summaries, and similarity scores.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Natural language search query",
        },
        max_results: {
          type: "number",
          description: "Number of results (default 5)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_entry_details",
    description:
      "Get full details of a specific setup entry including README, agents.md, manifest, and tags. Use this when you need implementation details from a specific setup.",
    input_schema: {
      type: "object" as const,
      properties: {
        entry_id: {
          type: "string",
          description: "Entry UUID from search results",
        },
      },
      required: ["entry_id"],
    },
  },
];

async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<{ result: string; entries?: unknown[] }> {
  switch (name) {
    case "search_knowledge_base": {
      const query = input.query as string;
      const maxResults = (input.max_results as number) || 5;

      const results = await searchEntries(query, {
        maxResults,
        threshold: 0.5,
      });

      const entries = results.map((r) => ({
        entry_id: r.entry_id,
        title: r.title,
        summary: r.summary,
        use_case: r.use_case,
        complexity: r.complexity,
        similarity: r.similarity,
      }));

      const resultText = results.length === 0
        ? "No matching setups found in the knowledge base."
        : results
            .map(
              (r, i) =>
                `${i + 1}. "${r.title || "Untitled"}" (entry_id: ${r.entry_id})\n   Similarity: ${(r.similarity * 100).toFixed(0)}%\n   Use case: ${r.use_case || "unknown"} | Complexity: ${r.complexity || "unknown"}\n   Summary: ${r.summary || "No summary"}`
            )
            .join("\n\n");

      return { result: resultText, entries };
    }

    case "get_entry_details": {
      const entryId = input.entry_id as string;

      const { data: entry, error } = await supabase
        .from("entries")
        .select("*")
        .eq("id", entryId)
        .single();

      if (error || !entry) {
        return { result: `Entry ${entryId} not found.` };
      }

      const { data: tags } = await supabase
        .from("tags")
        .select("tag_type, tag_value")
        .eq("entry_id", entryId);

      const parts = [
        `Title: ${entry.title || "Untitled"}`,
        `Source: ${entry.source_url}`,
        `Complexity: ${entry.complexity || "unknown"}`,
        `Use case: ${entry.use_case || "unknown"}`,
      ];

      if (tags && tags.length > 0) {
        parts.push(
          `Tags: ${tags.map((t: { tag_type: string; tag_value: string }) => t.tag_value).join(", ")}`
        );
      }

      if (entry.readme) {
        parts.push(`\n--- README ---\n${entry.readme}`);
      }
      if (entry.agents_md) {
        parts.push(`\n--- agents.md ---\n${entry.agents_md}`);
      }
      if (entry.manifest) {
        parts.push(
          `\n--- Manifest ---\n${JSON.stringify(entry.manifest, null, 2)}`
        );
      }

      return {
        result: parts.join("\n"),
        entries: [
          {
            entry_id: entry.id,
            title: entry.title,
            summary: entry.summary,
            source_url: entry.source_url,
            complexity: entry.complexity,
          },
        ],
      };
    }

    default:
      return { result: `Unknown tool: ${name}` };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const messages: Anthropic.MessageParam[] = body.messages || [];

    if (messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "Messages array is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const client = new Anthropic({ apiKey: key });
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        function send(event: Record<string, unknown>) {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
            );
          } catch {
            // Stream closed
          }
        }

        try {
          // Claude conversation loop — handle tool calls
          let currentMessages = [...messages];
          let iterations = 0;
          const MAX_ITERATIONS = 5; // Prevent infinite tool loops

          while (iterations < MAX_ITERATIONS) {
            iterations++;

            const response = await client.messages.create({
              model: process.env.LLM_MODEL || "claude-sonnet-4-20250514",
              max_tokens: 8192,
              system: BUILDER_CHAT_SYSTEM_PROMPT,
              tools: TOOLS,
              messages: currentMessages,
            });

            let hasToolUse = false;
            const toolResults: Anthropic.ToolResultBlockParam[] = [];

            for (const block of response.content) {
              if (block.type === "text") {
                // Stream text in chunks for a streaming feel
                const words = block.text.split(" ");
                let chunk = "";
                for (let i = 0; i < words.length; i++) {
                  chunk += (i === 0 ? "" : " ") + words[i];
                  if (chunk.length > 20 || i === words.length - 1) {
                    send({ type: "text_delta", content: chunk });
                    chunk = "";
                  }
                }
              } else if (block.type === "tool_use") {
                hasToolUse = true;

                // Notify client about tool call
                send({
                  type: "tool_call",
                  name: block.name,
                  input: block.input,
                });

                // Execute tool
                const toolOutput = await executeTool(
                  block.name,
                  block.input as Record<string, unknown>
                );

                // Send entry references to client for inline rendering
                if (toolOutput.entries) {
                  for (const entry of toolOutput.entries) {
                    send({ type: "entry_reference", entry });
                  }
                }

                // Notify client about tool result
                const summary =
                  block.name === "search_knowledge_base"
                    ? `Found ${(toolOutput.entries || []).length} relevant setup(s)`
                    : `Loaded entry details`;
                send({
                  type: "tool_result",
                  name: block.name,
                  summary,
                });

                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: toolOutput.result,
                });
              }
            }

            // If there were tool calls, feed results back and continue loop
            if (hasToolUse) {
              currentMessages = [
                ...currentMessages,
                { role: "assistant", content: response.content },
                { role: "user", content: toolResults },
              ];
              continue;
            }

            // No tool calls — we're done
            break;
          }

          send({ type: "done" });
          controller.close();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          send({ type: "error", message });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
