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
  github: "GitHub",
  google_calendar: "Google Calendar",
  google_docs: "Google Docs",
  google_sheets: "Google Sheets",
  slack: "Slack",
};

/**
 * One-line marketing description per provider, shown under the
 * provider name in the settings list. Stays generic enough that we
 * don't have to update it as Composio adds actions.
 */
export const PROVIDER_TAGLINES: Record<IntegrationProvider, string> = {
  notion: "Pages, databases, and search across your workspace.",
  gmail: "Read and send mail through your connected inbox.",
  google_drive: "Files, folders, and Docs/Sheets file content.",
  github: "Issues, pull requests, repos, and code search.",
  google_calendar: "Events, schedules, and meeting management.",
  google_docs: "Read, edit, and create documents.",
  google_sheets: "Read and write spreadsheet rows and ranges.",
  slack: "Messages, channels, and reactions.",
};

/**
 * Provider logo URLs. Sourced from simpleicons.org's CDN — same
 * pattern dev-tooling sites use. Black-on-light variants for the
 * Notion / GitHub icons that render poorly at small sizes against
 * the light-on-dark Dopl theme.
 *
 * `null` means "no logo available" — the UI falls back to a colored
 * monogram chip. Add an entry here when registering a new provider.
 */
export const PROVIDER_LOGO_URL: Record<IntegrationProvider, string | null> = {
  notion: "https://cdn.simpleicons.org/notion/ffffff",
  gmail: "https://cdn.simpleicons.org/gmail/EA4335",
  google_drive: "https://cdn.simpleicons.org/googledrive",
  github: "https://cdn.simpleicons.org/github/ffffff",
  google_calendar: "https://cdn.simpleicons.org/googlecalendar/4285F4",
  google_docs: "https://cdn.simpleicons.org/googledocs/4285F4",
  google_sheets: "https://cdn.simpleicons.org/googlesheets/0F9D58",
  slack: "https://cdn.simpleicons.org/slack",
};
