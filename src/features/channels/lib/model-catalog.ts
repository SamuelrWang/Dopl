/**
 * The runtime-keyed model catalog the desktop hands over (`main/runtime/model-catalog.js`) — the one
 * place a runtime's model choices come from. Four statuses, never collapsed (INVARIANTS §11):
 * `loading` (nothing read yet), `ready`, `unavailable` (a read failed; `reason` says why) and `stale`
 * (still labels, may not be newly selected). An empty `models` list means nothing on its own.
 */

/** ⚠ A reply declaring any other version is ignored wholesale, never half-read. */
export const CATALOG_VERSION = 1;

export type CatalogStatus = "ready" | "loading" | "unavailable" | "stale";

const STATUSES: ReadonlyArray<CatalogStatus> = [
  "ready",
  "loading",
  "unavailable",
  "stale",
];

export interface ModelDimensionOption {
  value: string;
  label: string;
  description: string | null;
}

export interface ModelDimension {
  options: ReadonlyArray<ModelDimensionOption>;
  /** The platform's own pick, or `null` (never `""`). */
  default: string | null;
}

export interface CatalogModel {
  id: string;
  /** `null` = the runtime does not name it; render the raw id. */
  label: string | null;
  /** The chip word; falls back to {@link label}, never a truncation. */
  short: string | null;
  isDefault: boolean;
  /** Kept so a session already on it is still labelled; {@link selectableModels} never offers it. */
  hidden: boolean;
  /** Per model: Codex's supported efforts differ between models. */
  dimensions: Readonly<Record<string, ModelDimension>>;
  /** Other spellings of this model (a legacy stored id, a launch alias). Matched, never offered. */
  aliases: ReadonlyArray<string>;
}

export interface ModelCatalog {
  runtime: string;
  source: string | null;
  status: CatalogStatus;
  /** Operator-facing words. Non-empty on a `ready` catalog is a note, not a failure: read `status`. */
  reason: string;
  models: ReadonlyArray<CatalogModel>;
  /** The runtime's declared default. Displayed, never persisted on its own. */
  defaultId: string | null;
  dimensions: ReadonlyArray<string>;
  truncated: boolean;
}

/** Every runtime's catalog, keyed by runtime id. */
export type ModelCatalogs = Readonly<Record<string, ModelCatalog>>;

/** ⚠ Module-level so an absent map is the SAME identity every render. */
export const NO_CATALOGS: ModelCatalogs = Object.freeze({});
const NO_MODELS: ReadonlyArray<CatalogModel> = Object.freeze([]);
const NO_DIMENSIONS: Readonly<Record<string, ModelDimension>> = Object.freeze({});
const NO_ALIASES: ReadonlyArray<string> = Object.freeze([]);

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Narrow the wire's `catalogs` map. The version rides the reply, once per read. */
export function normalizeCatalogs(
  raw: unknown,
  version: unknown = CATALOG_VERSION
): ModelCatalogs {
  if (typeof version === "number" && version !== CATALOG_VERSION) return NO_CATALOGS;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NO_CATALOGS;
  const out: Record<string, ModelCatalog> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const catalog = normalizeCatalog(id, value);
    if (catalog) out[catalog.runtime] = catalog;
  }
  return Object.keys(out).length ? Object.freeze(out) : NO_CATALOGS;
}

function normalizeCatalog(id: unknown, raw: unknown): ModelCatalog | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const runtime = str(row.runtime) || str(id);
  if (!runtime) return null;
  const status = str(row.status) as CatalogStatus;
  // ⚠ An unknown status reads as `loading`, never `ready`: it offers nothing and refuses nothing.
  const known = STATUSES.indexOf(status) === -1 ? "loading" : status;
  const models: CatalogModel[] = [];
  for (const entry of Array.isArray(row.models) ? row.models : []) {
    const model = normalizeModel(entry);
    if (model && !models.some((m) => m.id === model.id)) models.push(model);
  }
  const defaultId = str(row.defaultId);
  return {
    runtime,
    source: str(row.source) || null,
    status: known,
    reason: str(row.reason),
    models: models.length ? models : NO_MODELS,
    defaultId: defaultId && models.some((m) => m.id === defaultId) ? defaultId : null,
    dimensions: (Array.isArray(row.dimensions) ? row.dimensions : [])
      .map(str)
      .filter((v) => v.length > 0),
    truncated: row.truncated === true,
  };
}

function normalizeModel(raw: unknown): CatalogModel | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = str(row.id);
  if (!id) return null;
  const label = str(row.label) || null;
  return {
    id,
    label,
    short: str(row.short) || label,
    isDefault: row.isDefault === true,
    hidden: row.hidden === true,
    dimensions: normalizeModelDimensions(row.dimensions),
    aliases: normalizeAliases(row.aliases, id),
  };
}

function normalizeAliases(raw: unknown, id: string): ReadonlyArray<string> {
  if (!Array.isArray(raw)) return NO_ALIASES;
  const out = raw.map(str).filter((v, i, a) => v.length > 0 && v !== id && a.indexOf(v) === i);
  return out.length ? Object.freeze(out) : NO_ALIASES;
}

function normalizeModelDimensions(
  raw: unknown
): Readonly<Record<string, ModelDimension>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NO_DIMENSIONS;
  const out: Record<string, ModelDimension> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const options: ModelDimensionOption[] = [];
    for (const opt of Array.isArray(row.options) ? row.options : []) {
      const o = (opt ?? {}) as Record<string, unknown>;
      const optValue = typeof opt === "string" ? str(opt) : str(o.value);
      if (!optValue || options.some((x) => x.value === optValue)) continue;
      options.push({
        value: optValue,
        label: str(o.label) || optValue,
        description: str(o.description) || null,
      });
    }
    // A dimension with no options is dropped, never rendered as an empty control (F-390).
    if (!options.length) continue;
    const fallback = str(row.default);
    out[key] = {
      options,
      default: options.some((o) => o.value === fallback) ? fallback : null,
    };
  }
  return Object.keys(out).length ? Object.freeze(out) : NO_DIMENSIONS;
}

/** One runtime's catalog, or `null`. ⚠ No fallback arm: a miss never answers another runtime's list. */
export function catalogFor(
  catalogs: ModelCatalogs | null | undefined,
  runtimeId: string | null | undefined
): ModelCatalog | null {
  const id = str(runtimeId);
  if (!id || !catalogs) return null;
  return catalogs[id] ?? null;
}

/**
 * The entry an id names: its own `id`, else one of its `aliases` — so a legacy stored id
 * (`claude-opus-5`) finds its live-roster row (`claude-opus-5[1m]`).
 */
export function findModel(
  c: ModelCatalog | null | undefined,
  id: string | null | undefined
): CatalogModel | null {
  const wanted = str(id);
  if (!wanted || !c) return null;
  return c.models.find((m) => m.id === wanted)
    ?? c.models.find((m) => m.aliases.includes(wanted))
    ?? null;
}

/** `true` only when the catalog is a list an operator may pick from now. */
export const catalogReady = (c: ModelCatalog | null | undefined): boolean =>
  c?.status === "ready";

/** The sentence a surface shows, driven by status (never `models.length`); `null` while loading. */
export function catalogReason(c: ModelCatalog | null | undefined): string | null {
  if (!c) return null;
  if (c.status === "loading") return null;
  return c.reason || null;
}

/**
 * The models a picker may offer: visible members of a `ready` catalog, in the runtime's own order
 * (never re-sorted). `stale`, `unavailable` and `loading` offer nothing.
 */
export function selectableModels(
  c: ModelCatalog | null | undefined
): ReadonlyArray<CatalogModel> {
  if (!catalogReady(c) || !c) return NO_MODELS;
  const visible = c.models.filter((m) => !m.hidden);
  return visible.length ? visible : NO_MODELS;
}

/** The runtime's label for an id, else the raw id (never blank). Reads any status: labelling is not selecting. */
export function modelLabel(
  c: ModelCatalog | null | undefined,
  id: string | null | undefined
): string {
  const wanted = str(id);
  if (!wanted) return "";
  return findModel(c, wanted)?.label || wanted;
}

/**
 * What the model row shows: a stored id as the row it names (an unknown one as itself), else the
 * runtime's declared default. Showing the default persists nothing.
 */
export function catalogSelection(
  c: ModelCatalog | null | undefined,
  stored: string | null | undefined
): string {
  const trimmed = str(stored);
  if (trimmed) return findModel(c, trimmed)?.id ?? trimmed;
  return c?.defaultId ?? "";
}

/** A select's options. ⚠ An off-roster current value is appended, or `SelectMenu` renders blank. */
export function modelOptionsFor(
  c: ModelCatalog | null | undefined,
  effective: string | null | undefined
): ReadonlyArray<{ value: string; label: string }> {
  const options = selectableModels(c).map((m) => ({
    value: m.id,
    label: m.label || m.id,
  }));
  const trimmed = findModel(c, effective)?.id ?? str(effective);
  if (!trimmed || options.some((o) => o.value === trimmed)) return options;
  return [...options, { value: trimmed, label: modelLabel(c, trimmed) }];
}
