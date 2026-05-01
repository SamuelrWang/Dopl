/**
 * Source provider types for knowledge feature integrations (Slack,
 * Gmail, Drive, etc.). Used by the connector badges in the workspace
 * overview and (legacy) by the skills feature.
 *
 * The actual integrations are out-of-scope for the Item 1-5 overhaul —
 * these types are kept here so the badge UI compiles and the skills
 * feature's hardcoded fixtures can typecheck without depending on the
 * deleted `data.ts`.
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
