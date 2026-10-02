import type { AttributeValue, ObjectAttribute, TemplateField } from "./types";

/**
 * THE FIELD KINDS — one declaration of the closed set, the empty value each kind
 * is born with, and the value rules the server enforces (`schema.ts`) and the
 * panel checks before it writes (`components/field-value-editors.tsx`).
 *
 * ⚠ HAND-MIRRORED in `packages/mcp-server/src/tools/ontology-fields.ts` (that
 * tree cannot import `src/`), and in `packages/dopl-client/src/ontology-types.ts`
 * for the union. Change all three together.
 *
 * `enum` / `date` / `link` are STRING kinds: `""` is "not set yet", which is what
 * a field is born with, so every rule below admits the empty string.
 */
export const FIELD_KINDS = [
  "text",
  "pill",
  "enum",
  "date",
  "link",
  "ref",
  "knowledge",
  "skill",
] as const satisfies ReadonlyArray<AttributeValue["kind"]>;

export type FieldKind = (typeof FIELD_KINDS)[number];

/** Kinds whose value is ONE string (the rest are id lists). */
export type StringKind = "text" | "pill" | "enum" | "date" | "link";

export function isStringKind(kind: FieldKind): kind is StringKind {
  return (
    kind === "text" || kind === "pill" || kind === "enum" || kind === "date" || kind === "link"
  );
}

/** A fresh, empty value of `kind`. */
export function emptyValue(kind: FieldKind): AttributeValue {
  return isStringKind(kind) ? { kind, value: "" } : { kind, value: [] };
}

/** Caps, stated once (the MCP mirror repeats them). */
export const ENUM_OPTION_MAX = 200;
export const ENUM_OPTIONS_MAX = 50;
export const LINK_VALUE_MAX = 2000;
export const FIELD_DESCRIPTION_MAX = 1000;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` naming a real calendar day (no `2026-02-30`). */
export function isIsoDate(value: string): boolean {
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
  );
}

/** An absolute `http:` / `https:` URL — the only links a field may hold. */
export function isHttpUrl(value: string): boolean {
  if (value.length > LINK_VALUE_MAX) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
}

/** `Oct 1, 2026` — read in UTC, because the stored value is a calendar day,
 *  and reading it in local time moves it a day west of Greenwich. */
export function formatIsoDate(value: string): string {
  if (!isIsoDate(value)) return value;
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Trimmed, non-empty, first-spelling-wins options (case-insensitive). */
export function cleanOptions(options: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of options) {
    const option = raw.trim();
    if (!option) continue;
    if (out.some((o) => o.toLowerCase() === option.toLowerCase())) continue;
    out.push(option);
  }
  return out;
}

/** The value violates its kind's rule — `null` when it is fine. */
export function valueProblem(
  value: AttributeValue,
  options: readonly string[] | undefined,
): string | null {
  if (value.kind === "enum" && value.value !== "" && !(options ?? []).includes(value.value)) {
    return `"${value.value}" is not one of this field's options`;
  }
  if (value.kind === "date" && value.value !== "" && !isIsoDate(value.value)) {
    return "a date must be YYYY-MM-DD";
  }
  if (value.kind === "link" && value.value !== "" && !isHttpUrl(value.value)) {
    return "a link must be an http(s) URL";
  }
  return null;
}

/**
 * A template field → the empty attribute a new child is born with. ONE copy for
 * the server (`server/service.ts › createObject`) and the optimistic row
 * (`optimistic-create.ts › pendingObject`), so the two cannot drift.
 * Description and options travel with the field so the child can render and
 * validate on its own.
 */
export function attributeFromField(field: TemplateField): ObjectAttribute {
  return {
    key: field.key,
    label: field.label,
    value: emptyValue(field.kind),
    ...(field.description ? { description: field.description } : {}),
    ...(field.kind === "enum" && field.options?.length ? { options: [...field.options] } : {}),
  };
}

/** The `key` a label is addressed at — the one slug rule for fields. */
export function fieldKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, "-");
}
