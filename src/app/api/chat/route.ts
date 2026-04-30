import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { BUILDER_CHAT_SYSTEM_PROMPT } from "@/shared/prompts/chat-system";
import { withUserAuth } from "@/shared/auth/with-auth";
import { hasActiveAccess, accessDeniedBody } from "@/features/billing/server/access";
import { logSystemEvent } from "@/features/analytics/server/system-events";
import {
  buildCanvasContextPrefix,
  type CanvasContextPayload,
} from "@/features/chat/server/canvas-context";
import { TOOLS, executeTool } from "@/features/chat/server/tools";
import { resolveActiveCanvas } from "@/features/canvases/server/service";
import { HttpError } from "@/shared/lib/http-error";
import { config } from "dotenv";
import { resolve } from "path";

// Force-load env (same pattern as ai.ts)
config({ path: resolve(process.cwd(), ".env.local"), override: true });

export const dynamic = "force-dynamic";

/**
 * Build a human-readable summary for the tool_result SSE event so the
 * UI can render a status badge ("Queued for ingestion", "Read cluster
 * brain", etc.) without parsing the underlying JSON.
 */
function toolSummary(
  name: string,
  toolOutput: { result: string; entries?: unknown[] }
): string {
  if (name === "search_knowledge_base") {
    return `Found ${(toolOutput.entries || []).length} relevant source(s)`;
  }
  if (name === "ingest_url") {
    // Branch on actual tool result status so the badge doesn't lie
    // ("Done" used to render even when the tool refused).
    try {
      const parsed = JSON.parse(toolOutput.result);
      if (parsed.status === "queued") return "Queued for ingestion";
      if (parsed.status === "already_exists") return "Already ingested";
      if (parsed.status === "processing") return "Started ingestion";
      if (parsed.status === "error") return "Ingestion error";
    } catch {
      // fall through
    }
    return "Queued for ingestion";
  }
  switch (name) {
    case "list_user_clusters":
      return "Listed clusters";
    case "list_cluster_brain_memories":
      return "Read cluster brain";
    case "add_cluster_brain_memory":
      return "Added memory to cluster brain";
    case "update_cluster_brain_memory":
      return "Updated cluster brain memory";
    case "remove_cluster_brain_memory":
      return "Removed cluster brain memory";
    case "rewrite_cluster_brain_instructions":
      return "Rewrote cluster brain instructions";
    default:
      return "Retrieved implementation details";
  }
}

async function handlePost(
  request: NextRequest,
  { userId }: { userId: string }
) {
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

    // Resolve active canvas — header > user default. Cluster-scoped
    // tools (list/edit memories, rewrite brain) need this to filter
    // canvas-aware queries; non-canvas tools (search KB, ingest URL)
    // ignore it.
    let canvasId: string;
    try {
      const headerCanvasId = request.headers.get("x-canvas-id");
      const { canvas } = await resolveActiveCanvas(userId, headerCanvasId);
      canvasId = canvas.id;
    } catch (err) {
      if (err instanceof HttpError) {
        return new Response(JSON.stringify(err.toResponseBody()), {
          status: err.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw err;
    }

    // Access gate: trialing or paid. Expired trials 402.
    const access = await hasActiveAccess(userId);
    if (!access.allowed) {
      return new Response(
        JSON.stringify(accessDeniedBody(access)),
        { status: 402, headers: { "Content-Type": "application/json" } }
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
          const MAX_ITERATIONS = 5;
          const ingestedUrls = new Set<string>();
          let hadToolCalls = false;

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
              hadToolCalls = true;

              send({
                type: "tool_call",
                name: block.name,
                input: block.input,
              });

              const toolOutput = await executeTool(
                block.name,
                block.input as Record<string, unknown>,
                userId,
                canvasContext,
                canvasId
              );

              // Emit ingest_started for ingest_url tool so the frontend
              // can spawn an entry panel and connect to the progress stream.
              // Skip if we already ingested this URL in this session (dedup).
              if (block.name === "ingest_url") {
                const urlArg = (block.input as Record<string, unknown>).url as string;
                try {
                  const parsed = JSON.parse(toolOutput.result);
                  if (urlArg && ingestedUrls.has(urlArg)) {
                    // Already ingested this URL in this chat turn — skip
                  } else {
                    if (urlArg) ingestedUrls.add(urlArg);
                    send({
                      type: "ingest_started",
                      entry_id: parsed.entry_id,
                      stream_url: parsed.stream_url,
                      status: parsed.status,
                      title: parsed.title,
                    });
                  }
                } catch {
                  // Failed to parse — skip the event
                }
              }

              if (toolOutput.entries) {
                for (const entry of toolOutput.entries) {
                  send({ type: "entry_reference", entry });
                }
              }

              send({
                type: "tool_result",
                name: block.name,
                summary: toolSummary(block.name, toolOutput),
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

          // Access-only gating now — no credit math needed on success.
          // Silence unused-variable lint warnings without removing the
          // variable (future analytics hook).
          void hadToolCalls;

          send({ type: "done" });
          controller.close();
        } catch (error) {
          // Access-only gating now — no credit refund needed on error.
          const message =
            error instanceof Error ? error.message : "Unknown error";
          logSystemEvent({
            severity: "error",
            category: "other",
            source: "chat.handler_error",
            message: `Chat handler threw: ${message}`,
            fingerprintKeys: ["chat_error"],
            metadata: { user_id: userId },
            userId,
          }).catch(() => {});
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

export const POST = withUserAuth(handlePost);
