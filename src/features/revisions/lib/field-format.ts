import type { Revision } from "../types";

/**
 * **THE ONTOLOGY ROW'S THREE STRINGS — label, before, after.** Pure, so the
 * renderer stays a layout and the test can address the arithmetic directly.
 *
 * ⚠ **IT FORMATS FOR A ONE-LINE ROW, NOT FOR A DOCUMENT.** An ontology payload
 * is a value out of a JSONB bag — an attribute union, a list of actions, a share
 * record — and a changelog row has one line to say what moved. Anything with no
 * short honest rendering becomes a COUNT ("3 items") rather than a truncated
 * blob, because a blob cut at 40 characters reads as a value that ends there.
 *
 * ⚠ **IT IS NOT A DIFF.** The expanded row diffs the two strings this produces
 * (`components/revision-diff.tsx`); nothing here compares anything.
 */

/** ⚠ Mirrors `ontology/server/service-revisions.ts › ATTRIBUTE_FIELD_PREFIX`.
 *  It is a WIRE fact — it arrives inside `payload.field` from the server — so
 *  the renderer reads it rather than importing a `server-only` module. */
const ATTRIBUTE_PREFIX = "attribute:";
const SHARE_PREFIX = "share:";

/** The empty rendering, used for both halves. ⚠ ONE glyph for "there was no
 *  value", never an empty string: a row reading `Stage:  → Won` looks broken. */
export const NO_VALUE = "—";

/**
 * A field key as a person reads it. `attribute:stage` → `Stage`;
 * `agentsMayEdit` → `Agents may edit`; `share:<channelId>` → `Sharing`.
 *
 * ⚠ THE CHANNEL ID IS DROPPED FROM A SHARE LABEL ON PURPOSE — it is an id in a
 * container the reader may not be in, and the levels in the value are what the
 * row is about.
 */
export function fieldLabel(field: string): string {
  if (field.startsWith(SHARE_PREFIX)) return "Sharing";
  const bare = field.startsWith(ATTRIBUTE_PREFIX)
    ? field.slice(ATTRIBUTE_PREFIX.length)
    : field;
  // ⚠ ONLY THE LETTER AT A camelCase BOUNDARY IS LOWERED, never the whole
  // string: an attribute key is a USER's word, and lowercasing it would render
  // "CEO" as "ceo" in the one place the reader is checking what changed.
  const spaced = bare
    .replace(/([a-z0-9])([A-Z])/g, (_m, a: string, b: string) => `${a} ${b.toLowerCase()}`)
    .replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** One value → one line. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return NO_VALUE;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return formatList(value);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    // An ontology ATTRIBUTE is `{kind, value}` — the union in
    // `ontology/types.ts › AttributeValue`. Its `value` is what a reader means
    // by the attribute, and the `kind` is a schema fact they did not change.
    if ("kind" in record && "value" in record) return formatValue(record.value);
    // ⚠ SORTED, so the same record renders the same string twice — a row whose
    // text depends on key insertion order diffs against itself.
    const entries = Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1));
    if (entries.length === 0) return NO_VALUE;
    return entries.map(([k, v]) => `${fieldLabel(k)} ${formatValue(v)}`).join(", ");
  }
  return String(value);
}

function formatList(value: unknown[]): string {
  if (value.length === 0) return NO_VALUE;
  if (value.every((v) => typeof v === "string")) return value.join(", ");
  // ⚠ A COUNT, not a serialization. A list of actions or template fields has no
  // one-line rendering that is both short and true.
  return `${value.length} ${value.length === 1 ? "item" : "items"}`;
}

export interface RevisionFieldLine {
  label: string;
  before: string;
  after: string;
  /** An edge rather than a property — the renderer marks it and never offers
   *  Restore for it (`./restorable.ts`). */
  association: boolean;
}

/**
 * The `field: before → after` line, or `null` when this revision is not a field
 * row (every knowledge revision, and an ontology `create`/`delete` bundle).
 *
 * ⚠ **KEYED ON THE PAYLOAD, NOT ON `resourceType` ALONE.** A create bundle is an
 * `ontology_object` row too, and it has no `field` — asking the type would draw
 * a line reading `undefined: — → —`.
 */
export function fieldLineOf(revision: Revision): RevisionFieldLine | null {
  const { field, before, after, association } = revision.payload;
  if (field === undefined) return null;
  return {
    label: fieldLabel(field),
    before: formatValue(before),
    after: formatValue(after),
    association: association !== undefined,
  };
}

/** The `{fields}` bundle a `create`/`delete` row carries, as label/value pairs
 *  in a stable order. Empty for every row that is not a bundle. */
export function bundleOf(revision: Revision): Array<{ label: string; value: string }> {
  const fields = revision.payload.fields;
  if (!fields) return [];
  return Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => ({ label: fieldLabel(key), value: formatValue(value) }));
}
