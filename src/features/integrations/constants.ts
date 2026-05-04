import { INTEGRATION_PROVIDERS, type IntegrationProvider } from "./types";

export { INTEGRATION_PROVIDERS };

/** Default page size for `list_integration_objects`. */
export const DEFAULT_LIST_LIMIT = 25;

/** Hard upper bound the agent can request. */
export const MAX_LIST_LIMIT = 100;

/**
 * Human-friendly provider names, used in consent-screen-adjacent copy
 * (the connect / done / error pages) and tool descriptions. Branding:
 * we never surface the broker's name — only the provider's.
 */
export const PROVIDER_DISPLAY_NAMES: Record<IntegrationProvider, string> = {
  notion: "Notion",
  gmail: "Gmail",
  google_drive: "Google Drive",
};
