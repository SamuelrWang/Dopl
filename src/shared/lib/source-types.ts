/**
 * Source-provider types — canonical home. Consumed by the shared
 * SourceIcon, the skills feature (connector chips), and the knowledge
 * overview badges. Cross-feature, so it lives in shared/ (moved out of
 * features/knowledge in the skills phase-3 pass).
 */

export type SourceProvider =
  | "slack"
  | "google-drive"
  | "gmail"
  | "notion"
  | "github";

export interface SourceConnection {
  provider: SourceProvider;
  name: string;
  status: "connected" | "available";
  meta?: string;
}
