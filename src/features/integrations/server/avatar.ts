import "server-only";
import { createHash } from "node:crypto";

/**
 * Build a Gravatar avatar URL from an email. Uses SHA-256 (the
 * post-2023 Gravatar format) so we can stay on Web/Node crypto
 * without pulling in a third-party MD5 library.
 *
 * `d=mp` falls back to a generic silhouette when no Gravatar is
 * registered for the email — predictable and recognizable as a
 * placeholder rather than 404'ing.
 *
 * Returns null when there's no email to hash. The UI uses that null
 * to swap in a first-letter chip.
 */
export function gravatarUrlForEmail(email: string | null): string | null {
  if (!email) return null;
  const hash = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex");
  return `https://gravatar.com/avatar/${hash}?s=128&d=mp`;
}
