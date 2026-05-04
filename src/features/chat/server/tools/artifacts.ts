import "server-only";
import type { ToolResult } from "./types";

/**
 * Artifact-emit tools — exclusive to the private chat.
 *
 * These tools don't read or mutate any data. They exist so the model
 * can declare "render this as an artifact card" through the same
 * tool-call channel as everything else. The route handler intercepts
 * tool calls with these names and emits an `artifact` SSE event the
 * client renders as an inline `<AgentPromptCard>` / `<ContextFileCard>`.
 *
 * The handler returns an "ok" payload to Claude so the conversation
 * continues normally.
 */

export interface AgentPromptArtifact {
  kind: "agent_prompt";
  id: string;
  title: string;
  prompt: string;
}

export interface ContextFileArtifact {
  kind: "context_file";
  id: string;
  title: string;
  markdown: string;
}

export type ArtifactPayload = AgentPromptArtifact | ContextFileArtifact;

export async function executeEmitAgentPrompt(
  input: Record<string, unknown>
): Promise<ToolResult> {
  const title = (input.title as string)?.trim();
  const prompt = (input.prompt as string)?.trim();
  if (!title || !prompt) {
    return {
      result: JSON.stringify({
        error: "title and prompt are both required.",
      }),
    };
  }
  return {
    result: JSON.stringify({
      status: "rendered",
      kind: "agent_prompt",
      title,
    }),
  };
}

export async function executeEmitContextFile(
  input: Record<string, unknown>
): Promise<ToolResult> {
  const title = (input.title as string)?.trim();
  const markdown = (input.markdown as string)?.trim();
  if (!title || !markdown) {
    return {
      result: JSON.stringify({
        error: "title and markdown are both required.",
      }),
    };
  }
  return {
    result: JSON.stringify({
      status: "rendered",
      kind: "context_file",
      title,
    }),
  };
}

/**
 * Helper used by the route handler to extract the artifact payload from
 * a tool call's input. Returns null for non-artifact tool names or
 * invalid payloads. Centralised so the route doesn't reimplement the
 * shape check in two places.
 */
export function buildArtifactFromToolCall(
  toolName: string,
  input: Record<string, unknown>,
  id: string
): ArtifactPayload | null {
  if (toolName === "emit_agent_prompt") {
    const title = (input.title as string)?.trim();
    const prompt = (input.prompt as string)?.trim();
    if (!title || !prompt) return null;
    return { kind: "agent_prompt", id, title, prompt };
  }
  if (toolName === "emit_context_file") {
    const title = (input.title as string)?.trim();
    const markdown = (input.markdown as string)?.trim();
    if (!title || !markdown) return null;
    return { kind: "context_file", id, title, markdown };
  }
  return null;
}
