import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { BUILDER_CHAT_SYSTEM_PROMPT } from "@/shared/prompts/chat-system";
import { PRIVATE_CHAT_SYSTEM_PROMPT } from "@/shared/prompts/private-chat-system";
import { withUserAuth } from "@/shared/auth/with-auth";
import { hasActiveAccess, accessDeniedBody } from "@/features/billing/server/access";
import { logSystemEvent } from "@/features/analytics/server/system-events";
import {
  buildCanvasContextPrefix,
  type CanvasContextPayload,
} from "@/features/chat/server/canvas-context";
import {
  WORKSPACE_TOOLS,
  PRIVATE_TOOLS,
  executeTool,
  type ChatMode,
  type ChatScopeFilters,
} from "@/features/chat/server/tools";
import { buildArtifactFromToolCall } from "@/features/chat/server/tools/artifacts";
import { getCluster } from "@/features/clusters/server/service";
import { resolveActiveWorkspace } from "@/features/workspaces/server/service";
import { HttpError } from "@/shared/lib/http-error";
import { config } from "dotenv";
import { resolve } from "path";

// Force-load env (same pattern as ai.ts)
config({ path: resolve(process.cwd(), ".env.local"), override: true });

export const dynamic = "force-dynamic";

/**
 * Build a human-readable summary for the tool_result SSE event so the
 * UI can render a status badge ("Queued for ingestion", "Listed
 * clusters", etc.) without parsing the underlying JSON.
 */
function toolSummary(
  name: string,
  toolOutput: { result: string; entries?: unknown[] }
): string {
  if (name === "search_workspace_knowledge") {
    try {
      const parsed = JSON.parse(toolOutput.result);
      const n = Array.isArray(parsed?.matches) ? parsed.matches.length : 0;
      return `Found ${n} match(es) in workspace knowledge`;
    } catch {
      return "Searched workspace knowledge";
    }
  }
  if (name === "list_workspace_knowledge_bases") {
    try {
      const parsed = JSON.parse(toolOutput.result);
      const n = Array.isArray(parsed?.knowledge_bases)
        ? parsed.knowledge_bases.length
        : 0;
      return `${n} knowledge base${n === 1 ? "" : "s"}`;
    } catch {
      return "Listed knowledge bases";
    }
  }
  if (name === "list_workspace_skills") {
    try {
      const parsed = JSON.parse(toolOutput.result);
      const n = Array.isArray(parsed?.skills) ? parsed.skills.length : 0;
      return `${n} skill${n === 1 ? "" : "s"}`;
    } catch {
      return "Listed skills";
    }
  }
  switch (name) {
    case "list_workspace_clusters":
      return "Listed clusters";
    case "read_knowledge_entry":
      return "Read knowledge entry";
    case "read_skill_file":
      return "Read skill file";
    case "emit_agent_prompt":
      return "Drafted an agent prompt";
    case "emit_context_file":
      return "Synthesized a context file";
    default:
      return "Retrieved implementation details";
  }
}

async function handlePost(
  request: NextRequest,
  { userId, agentTokenId }: { userId: string; agentTokenId?: string }
) {
  try {
    const body = await request.json();
    const messages: Anthropic.MessageParam[] = body.messages || [];
    const canvasContext: CanvasContextPayload | undefined = body.canvasContext;
    const requestedMode = body.mode === "private" ? "private" : "workspace";
    const mode: ChatMode = requestedMode;
    const scopeFilters: ChatScopeFilters | undefined =
      mode === "private" && body.scopeFilters && typeof body.scopeFilters === "object"
        ? (body.scopeFilters as ChatScopeFilters)
        : undefined;

    if (messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "Messages array is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Resolve active workspace — header > user default. Cluster-scoped
    // tools (list_workspace_clusters) need this to filter canvas-aware
    // queries; non-canvas tools (search KB, ingest URL) ignore it.
    let workspaceId: string;
    try {
      const headerWorkspaceId = request.headers.get("x-workspace-id");
      const { workspace } = await resolveActiveWorkspace(userId, headerWorkspaceId);
      workspaceId = workspace.id;
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

    // Server-side enrichment: when the chat is inside a synced cluster,
    // attach the cluster's KBs + skills so the system prompt has real
    // context. Failures are non-fatal — chat still works without the
    // enrichment. Skipped in private mode since the private chat doesn't
    // run inside a cluster.
    let enriched: CanvasContextPayload | undefined = canvasContext;
    if (
      mode === "workspace" &&
      canvasContext &&
      canvasContext.scope === "cluster" &&
      canvasContext.clusterSlug
    ) {
      try {
        const detail = await getCluster(canvasContext.clusterSlug, {
          userId,
          workspaceId,
          source: agentTokenId ? "agent" : "user",
        });
        enriched = {
          ...canvasContext,
          knowledgeBases: detail.knowledge_bases.map((kb) => ({
            knowledgeBaseId: kb.knowledge_base_id,
            slug: kb.slug,
            name: kb.name,
            description: kb.description,
            agentWriteEnabled: kb.agent_write_enabled,
            entriesIndex: kb.entries_index.map((e) => ({
              entryId: e.entry_id,
              title: e.title,
              folderPath: e.folder_path,
            })),
          })),
          skills: detail.skills.map((sk) => ({
            skillId: sk.skill_id,
            slug: sk.slug,
            name: sk.name,
            description: sk.description,
            whenToUse: sk.when_to_use,
            status: sk.status,
            body: sk.body,
          })),
        };
      } catch (err) {
        // Non-fatal: skip enrichment but keep the original payload.
        console.warn("chat: cluster enrichment failed", err);
      }
    }

    // Compose system prompt + tool set per mode.
    const baseSystemPrompt =
      mode === "private"
        ? PRIVATE_CHAT_SYSTEM_PROMPT
        : BUILDER_CHAT_SYSTEM_PROMPT;
    const systemPrompt =
      mode === "workspace" && enriched
        ? buildCanvasContextPrefix(enriched) + baseSystemPrompt
        : baseSystemPrompt;
    const toolSet =
      mode === "private" ? PRIVATE_TOOLS : WORKSPACE_TOOLS;

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
          let hadToolCalls = false;

          while (iterations < MAX_ITERATIONS) {
            iterations++;

            const modelStream = client.messages.stream({
              model: process.env.LLM_MODEL || "claude-sonnet-4-20250514",
              max_tokens: 8192,
              system: systemPrompt,
              tools: toolSet,
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
                workspaceId,
                { mode, scopeFilters }
              );

              // Artifact emission — private mode only. The tool itself
              // returned a no-op "rendered" payload to Claude; the
              // browser-facing artifact event carries the actual
              // title/prompt/markdown so the renderer can draw the card.
              if (
                mode === "private" &&
                (block.name === "emit_agent_prompt" ||
                  block.name === "emit_context_file")
              ) {
                const artifactId = randomUUID();
                const artifact = buildArtifactFromToolCall(
                  block.name,
                  block.input as Record<string, unknown>,
                  artifactId
                );
                if (artifact) {
                  send({ type: "artifact", artifact });
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
