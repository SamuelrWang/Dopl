/**
 * Pure constants for the publicId routing-handle scheme. Lives in its
 * own file (no `"server-only"` directive, no Node-only imports) so it
 * can be safely consumed from client components and shared URL parsers.
 *
 * The actual ID generator in `./public-id.ts` IS server-only because
 * it uses `node:crypto`.
 */
export const PUBLIC_ID_LENGTH = 12;
