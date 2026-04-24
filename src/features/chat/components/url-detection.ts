/**
 * URL detection for the real-chat panel.
 *
 * Rule: if the user's trimmed input contains ONLY a single URL (no other
 * text), we treat it as an ingestion shortcut. Anything else — even
 * "ingest https://example.com" — is a chat message that flows to
 * /api/chat normally.
 *
 * This lets the user still paste a bare link to kick off ingestion
 * (the v1 chat behavior) while making any other text-containing
 * message a real conversation turn.
 */

// http:// or https:// followed by one or more non-whitespace chars,
// optionally with leading/trailing whitespace. Anchored to ^$ so a URL
// buried in a sentence doesn't match.
const URL_ONLY_REGEX = /^\s*https?:\/\/\S+\s*$/;

/** True if the input is exactly one URL with no surrounding text. */
export function isUrlOnlyMessage(input: string): boolean {
  return URL_ONLY_REGEX.test(input);
}

/** Extract the URL from a url-only message (assumes isUrlOnlyMessage === true). */
export function extractUrl(input: string): string {
  return input.trim();
}
