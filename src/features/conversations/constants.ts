import type { ConversationSource, ExportFormat } from "./types";

export const SOURCE_LABELS: Record<ConversationSource, string> = {
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  cursor: "Cursor",
  other: "Agent",
};

export const FORMAT_LABELS: Record<ExportFormat, string> = {
  summarized: "Summarized",
  verbatim: "Verbatim",
  mixed: "Mixed",
};

export const UNFILED_LABEL = "Unfiled";
