/**
 * Shared resolvers + error mappers for the `dopl_kb` / `dopl_kb_admin`
 * tools. Base-reference resolution and the field-named validation-failure
 * mappers live here because the read, write, and admin op modules all lean
 * on them. The registrar (knowledge.ts) keeps op routing; these are the
 * cross-cutting internals.
 */

import type { DoplClient, KnowledgeBase } from "@dopl/client";
import { err, type ToolResponse } from "./respond";

/**
 * Resolves a base reference (slug or UUID) to a `KnowledgeBase` row.
 * Returns null when nothing matches. Calls `listKbBases` once per
 * invocation — fine for agent throughput, not great for tight loops.
 */
async function resolveBase(client: DoplClient, ref: string): Promise<KnowledgeBase | null> {
  const bases = await client.listKbBases();
  return bases.find((b) => b.slug === ref || b.id === ref) ?? null;
}

/**
 * resolveBase + the standard not-found error. Returns the base, or a
 * ToolResponse error (caller short-circuits on the `isError` branch).
 */
export async function resolveBaseOr(client: DoplClient, ref: string): Promise<KnowledgeBase | ToolResponse> {
  const base = await resolveBase(client, ref);
  if (!base)
    return err(`Knowledge base not found: ${ref}. If you may have deleted it, check \`dopl_kb(op='list_trash')\` and restore with \`dopl_kb(op='restore_base')\`.`);
  return base;
}

export function isErr(x: KnowledgeBase | ToolResponse): x is ToolResponse {
  return "isError" in x && x.isError === true;
}

/**
 * Clean surface for the F-10 read-only-base delete rejection. The API
 * returns 403 `AGENT_WRITE_DISABLED` when an agent tries to delete a base
 * (or anything inside it) that's flagged `agent_write_enabled=false`.
 * Surface the server's actionable message verbatim instead of a raw throw
 * or a `CODE: message` dump. Returns null otherwise so the caller rethrows.
 * Duck-typed on `.status` / `.code` to avoid importing the @dopl/client
 * error class across the module boundary (same pattern as isConflict).
 */
export function agentWriteDenied(e: unknown): ToolResponse | null {
  if (
    typeof e !== "object" ||
    e === null ||
    (e as { status?: number }).status !== 403 ||
    (e as { code?: unknown }).code !== "AGENT_WRITE_DISABLED"
  ) {
    return null;
  }
  const msg = (e as { apiMessage?: unknown }).apiMessage;
  return err(
    typeof msg === "string" && msg
      ? msg
      : "This knowledge base is read-only to agents — delete it from the Dopl web UI."
  );
}

/**
 * True when a thrown @dopl/client error is a 400 schema-validation
 * failure (`{ error: { code: "VALIDATION_FAILED", details } }`). Duck-typed
 * on `.status` / `.code` so it works across the @dopl/client module
 * boundary without importing the error class (same pattern as isConflict).
 */
function isValidationError(
  e: unknown
): e is { status: number; code: string; details: unknown } {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { status?: number }).status === 400 &&
    (e as { code?: unknown }).code === "VALIDATION_FAILED"
  );
}

/** Field names named by a validation error's zod-issue `details` array. */
function validationFields(details: unknown): Set<string> {
  const fields = new Set<string>();
  if (Array.isArray(details)) {
    for (const issue of details) {
      const path = (issue as { path?: unknown }).path;
      const first = Array.isArray(path) ? path[0] : undefined;
      if (typeof first === "string") fields.add(first);
    }
  }
  return fields;
}

/**
 * Bidirectional / directional-formatting control chars the name schema
 * rejects as an anti-spoofing measure: embeddings + overrides
 * (U+202A–U+202E), isolates (U+2066–U+2069), the LTR/RTL marks
 * (U+200E/U+200F), and the Arabic letter mark (U+061C). The class is built
 * from numeric code points (not a regex literal) so the source stays
 * pure-ASCII — no raw bidi controls sitting invisibly in this file — while
 * matching the exact same set the original regex literal did.
 */
const BIDI_CONTROL_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0x200e, 0x200f],
  [0x061c, 0x061c],
];

const BIDI_CONTROL_RE = new RegExp(
  `[${BIDI_CONTROL_RANGES.map(([lo, hi]) =>
    lo === hi
      ? String.fromCodePoint(lo)
      : `${String.fromCodePoint(lo)}-${String.fromCodePoint(hi)}`
  ).join("")}]`
);

/** `U+XXXX` for the first bidi control char in `text`, else null. */
function namedBidiChar(text: string): string | null {
  const m = BIDI_CONTROL_RE.exec(text);
  if (!m) return null;
  const cp = m[0].codePointAt(0) ?? 0;
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * Maps a `write_file` validation failure to a tool-shaped message naming
 * the field + rule + recovery (F-18). Returns null when the error isn't a
 * recognized validation failure so the caller rethrows.
 */
export function writeFileValidationError(e: unknown, title?: string): ToolResponse | null {
  if (!isValidationError(e)) return null;
  const fields = validationFields(e.details);
  // path is the only other write_file field and carries no schema rule
  // (z.string()), so a validation failure is a title (or body-size) issue.
  if (fields.has("title") || fields.size === 0) {
    const t = title ?? "";
    const bidi = namedBidiChar(t);
    if (bidi) {
      return err(
        `write_file: title contains a disallowed bidirectional control character (${bidi}) — remove it and retry (this block prevents right-to-left path spoofing).`
      );
    }
    if (t.includes("/")) {
      return err(
        `write_file: titles can't contain '/' (it's the path separator) — use a different title, or create the folder via the path and give the entry a clean title.`
      );
    }
    if (fields.has("title")) {
      return err(
        `write_file: title is invalid — it can't contain control or zero-width characters or leading/trailing whitespace. Use a plain title.`
      );
    }
  }
  if (fields.has("body")) {
    return err(`write_file: body is too large — the limit is 1 MB. Split it into multiple entries.`);
  }
  return err(
    `write_file: request body failed validation${fields.size ? ` (field: ${[...fields].join(", ")})` : ""}. Titles can't contain '/', control, or zero-width characters.`
  );
}

/**
 * Maps an `update_base` validation failure to a tool-shaped message
 * naming the field + rule + recovery (F-18). Returns null when the error
 * isn't a recognized validation failure so the caller rethrows.
 */
export function updateBaseValidationError(e: unknown): ToolResponse | null {
  if (!isValidationError(e)) return null;
  const fields = validationFields(e.details);
  if (fields.has("slug")) {
    return err(
      `update_base: slug must match ^[a-z0-9-]+$ — lowercase letters, digits, and hyphens only (no leading/trailing hyphen, no spaces).`
    );
  }
  if (fields.has("name")) {
    return err(`update_base: name can't be blank — pass a non-empty name, or omit it to leave the name unchanged.`);
  }
  if (fields.has("description")) {
    return err(`update_base: description is too long.`);
  }
  return err(
    `update_base: request body failed validation${fields.size ? ` (field: ${[...fields].join(", ")})` : ""}.`
  );
}
