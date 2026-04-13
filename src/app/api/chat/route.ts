import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { searchEntries } from "@/lib/retrieval/search";
import { supabaseAdmin } from "@/lib/supabase";
const supabase = supabaseAdmin();
import { BUILDER_CHAT_SYSTEM_PROMPT } from "@/lib/prompts/chat-system";
import { withExternalAuth } from "@/lib/auth/with-auth";
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

/**
 * Canvas context types — mirrors the CanvasContextPayload / ContextPanelDTO
 * from cluster-context.ts on the client side. Defined here independently
 * to keep the API route free of client-component imports.
 */
interface CanvasContextEntry {
  kind: "entry";
  entryId: string;
  title?: string;
  summary?: string | null;
  readme?: string;
  agentsMd?: string;
}
interface CanvasContextChat {
  kind: "chat";
  panelId: string;
  title?: string;
  messages: Array<{ role: string; content: string }>;
}
interface CanvasContextIngestion {
  kind: "ingestion";
  panelId: string;
  url: string;
  status: string;
}
type ContextPanelDTO = CanvasContextEntry | CanvasContextChat | CanvasContextIngestion;

interface CanvasContextPayload {
  scope: "cluster" | "canvas";
  clusterName?: string;
  panels: ContextPanelDTO[];
}

/**
 * Build a system-prompt prefix that primes Claude with the panels
 * loaded in the user's cluster. Handles entry, chat, and ingestion
 * panel types. Runs BEFORE the tool-based flow so the model has
 * cluster context inline.
 */
function buildCanvasContextPrefix(ctx: CanvasContextPayload): string {
  if (!ctx.panels || ctx.panels.length === 0) return "";

  let header: string;
  if (ctx.scope === "canvas") {
    header = `The user's canvas currently contains the following panels. You can see everything on their canvas — use this context to answer questions about what they're looking at, reference specific entries, and help them build on what they have:\n`;
  } else if (ctx.clusterName) {
    header = `You are currently chatting inside a cluster named "${ctx.clusterName}". The cluster contains the following panels — treat them as loaded context the user has already pulled into this conversation:\n`;
  } else {
    header = `You are currently chatting inside a cluster. The cluster contains the following panels — treat them as loaded context the user has already pulled into this conversation:\n`;
  }

  const blocks: string[] = [header];

  for (const p of ctx.panels) {
    const parts: string[] = [];
    switch (p.kind) {
      case "entry":
        parts.push(`── Entry: ${p.title || "Untitled"} (entry_id: ${p.entryId})`);
        if (p.summary) parts.push(`Summary: ${p.summary}`);
        if (p.readme) parts.push(`README:\n${p.readme}`);
        if (p.agentsMd) parts.push(`agents.md:\n${p.agentsMd}`);
        break;
      case "chat":
        parts.push(`── Chat: ${p.title || "Untitled Chat"}`);
        if (p.messages.length > 0) {
          parts.push("Recent messages:");
          for (const m of p.messages) {
            parts.push(`  ${m.role}: ${m.content}`);
          }
        } else {
          parts.push("(no messages yet)");
        }
        break;
      case "ingestion":
        parts.push(`── Ingestion: ${p.url || "(no URL)"} (status: ${p.status})`);
        break;
    }
    blocks.push(parts.join("\n"));
  }

  blocks.push(
    ctx.scope === "canvas"
      ? "When the user asks about what's on their canvas or references panels they can see, answer from the context above. You can still call search_knowledge_base and get_entry_details for entries NOT on the canvas when relevant."
      : "When the user asks about things in the cluster, prefer answering from the context above. You can still call search_knowledge_base and get_entry_details for entries OUTSIDE the cluster when relevant."
  );
  return blocks.join("\n\n") + "\n\n";
}

async function handlePost(request: NextRequest) {
  try {
    const body = await request.json();
    const messages: Anthropic.MessageParam[] = body.messages || [];
    const canvasContext: CanvasContextPayload | undefined = body.canvasContext;

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

    // Compose system prompt: canvas context (if any) + builder prompt.
    const systemPrompt = canvasContext
      ? buildCanvasContextPrefix(canvasContext) + BUILDER_CHAT_SYSTEM_PROMPT
      : BUILDER_CHAT_SYSTEM_PROMPT;

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
          // Claude conversation loop — handle tool calls across rounds.
          // Each round opens a real streaming response (client.messages.stream)
          // so text_delta events flow to the browser as Claude emits them,
          // giving a genuine typewriter effect instead of the entire message
          // landing at once.
          let currentMessages = [...messages];
          let iterations = 0;
          const MAX_ITERATIONS = 5; // Prevent infinite tool loops

          while (iterations < MAX_ITERATIONS) {
            iterations++;

            const modelStream = client.messages.stream({
              model: process.env.LLM_MODEL || "claude-sonnet-4-20250514",
              max_tokens: 8192,
              system: systemPrompt,
              tools: TOOLS,
              messages: currentMessages,
            });

            // Iterate the raw event stream. We care about two things:
            //   1. text_delta events → forward to the browser immediately
            //      so each token shows up in the UI as it arrives.
            //   2. the final message — needed AFTER the stream ends to
            //      pull out tool_use blocks and decide whether to loop.
            for await (const event of modelStream) {
              if (
                event.type === "content_block_delta" &&
                event.delta.type === "text_delta"
              ) {
                send({ type: "text_delta", content: event.delta.text });
              }
            }

            // Now that the stream is exhausted we can ask for the final,
            // fully-assembled message — this is cheap because the SDK has
            // been accumulating blocks internally as events flowed.
            const finalMessage = await modelStream.finalMessage();

            // Handle any tool_use blocks AFTER the text has already streamed
            // out. Tool calls happen at the end of a turn, so the user has
            // already seen any accompanying commentary by the time we get
            // here.
            let hasToolUse = false;
            const toolResults: Anthropic.ToolResultBlockParam[] = [];

            for (const block of finalMessage.content) {
              if (block.type !== "tool_use") continue;
              hasToolUse = true;

              send({
                type: "tool_call",
                name: block.name,
                input: block.input,
              });

              const toolOutput = await executeTool(
                block.name,
                block.input as Record<string, unknown>
              );

              if (toolOutput.entries) {
                for (const entry of toolOutput.entries) {
                  send({ type: "entry_reference", entry });
                }
              }

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

            // If there were tool calls, feed results back into the next
            // round so Claude can respond with the tool output in context.
            if (hasToolUse) {
              currentMessages = [
                ...currentMessages,
                { role: "assistant", content: finalMessage.content },
                { role: "user", content: toolResults },
              ];
              continue;
            }

            // No tool calls — we're done.
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

export const POST = withExternalAuth(handlePost);
