/** Source-provider types — canonical home. Cross-feature: shared SourceIcon,
 *  skills connector chips, knowledge overview badges. */

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
