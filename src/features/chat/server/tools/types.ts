import "server-only";
import type { CanvasContextPayload } from "../canvas-context";
import type { ArtifactPayload } from "./artifacts";

/**
 * Shape of every chat-tool handler's return value. `result` is the
 * text Claude sees as the tool output; `entries` is an optional list
 * of entry metadata the client streams back to the UI for rendering
 * as inline cards.
 *
 * `artifact` is an optional browser-facing artifact the route handler
 * forwards as an SSE `artifact` event. Unlike the `emit_*` tools — whose
 * artifact content comes from the MODEL's tool input — a tool can set
 * `artifact` here when the content is SERVER-sourced (e.g. the real KB
 * body fetched under the caller's access), so the card is faithful by
 * construction rather than trusting the model to reproduce it.
 */
export interface ToolResult {
  result: string;
  entries?: unknown[];
  artifact?: ArtifactPayload;
}

/**
 * Signature shared by every tool handler. userId is optional for
 * parity with the original dispatcher signature (each handler still
 * guards explicitly on auth when needed). workspaceId is the active
 * workspace scope; cluster-aware tools use it to filter cluster lookups.
 */
export type ToolHandler = (
  input: Record<string, unknown>,
  userId?: string,
  canvasContext?: CanvasContextPayload,
  workspaceId?: string
) => Promise<ToolResult>;
