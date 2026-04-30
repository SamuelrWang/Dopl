import "server-only";
import type { CanvasContextPayload } from "../canvas-context";

/**
 * Shape of every chat-tool handler's return value. `result` is the
 * text Claude sees as the tool output; `entries` is an optional list
 * of entry metadata the client streams back to the UI for rendering
 * as inline cards.
 */
export interface ToolResult {
  result: string;
  entries?: unknown[];
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
