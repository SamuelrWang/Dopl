/**
 * THE RUNTIME-KEYED MODEL CATALOG, AS THE DESKTOP HANDS IT OVER — the web side's reader for
 * `dopl-desktop-app/main/runtime/model-catalog.js`, and the ONE place a runtime's model choices
 * come from.
 *
 * ⚠ **IT REPLACES `agent-models.ts` AS EVERY RUNTIME'S SOURCE, AND THAT WAS THE BUG.** That file
 * is four Claude ids with four labels, and the New Agent dialog, the channel Settings row, the
 * profile-defaults row and the agent cards all read it whatever runtime was selected — so choosing
 * Codex offered Fable, Opus, Sonnet and Haiku, and submitted one of them. `agent-models.ts` stays
 * as the DEFAULT RUNTIME'S OLDER-DESKTOP FALLBACK and nothing else; every runtime-aware surface
 * reads a catalog.
 *
 * ⚠ **FOUR STATES, AND COLLAPSING ANY TWO IS THE BUG** (INVARIANTS §11 — UNKNOWN is not EMPTY):
 * `loading` (nothing read yet — show the platform default, never "no models"), `ready`,
 * `unavailable` (a read was ATTEMPTED and FAILED, and {@link catalogReason} says why), and
 * `stale` (models read from a binary/version we can no longer confirm — they still LABEL, and they
 * may not be newly SELECTED). An empty `models` list means NOTHING on its own.
 *
 * ⚠ **NO RUNTIME MAY BORROW ANOTHER'S MODELS, EVER.** {@link catalogFor} answers by runtime id or
 * answers `null`; there is no "else" arm, no merge, and no default list in this file. That is what
 * makes "a Codex surface can never render Fable" a structural property rather than a rule someone
 * has to remember.
 *
 * ⚠ NO HOOK, NO BRIDGE, NO REACT — the rule `permission-modes.ts` states and
 * `runtime-capability.ts` follows (INVARIANTS §1: one file, one reason to change). Anything that
 * reaches `window.dopl` belongs in a hook; anything that renders belongs in a component. The ONE
 * reason this file changes is that the desktop's catalog contract changed.
 *
 * ⚠ EVERY FIELD IS OPTIONAL AND EVERY VALUE IS NARROWED RATHER THAN ASSERTED: it crossed a process
 * boundary from a build that may be older OR newer than this bundle.
 */

/** The version of the catalog SHAPE this bundle understands. ⚠ A reply declaring any other is
 *  ignored wholesale — a half-understood record is worse than the older-desktop fallback. */
export const CATALOG_VERSION = 1;

export type CatalogStatus = "ready" | "loading" | "unavailable" | "stale";

const STATUSES: ReadonlyArray<CatalogStatus> = [
  "ready",
  "loading",
  "unavailable",
  "stale",
];

/** One option of a model-scoped dimension (Codex's reasoning effort today). */
export interface ModelDimensionOption {
  value: string;
  label: string;
  description: string | null;
}

export interface ModelDimension {
  options: ReadonlyArray<ModelDimensionOption>;
  /** The platform's own pick, or `null` when it declared none. ⚠ NEVER `""`. */
  default: string | null;
}

export interface CatalogModel {
  id: string;
  /** The runtime's own display name, or `null` when it does not name its models.
   *  ⚠ `null` MEANS "RENDER THE RAW ID", never "unnamed". */
  label: string | null;
  /** The glance word for a card chip. Falls back to {@link label}, never to a truncation. */
  short: string | null;
  isDefault: boolean;
  /** ⚠ CARRIED, NOT DROPPED: a session already on a hidden model still has to be LABELLED.
   *  {@link selectableModels} is what keeps it out of ordinary pickers. */
  hidden: boolean;
  /** `{ reasoningEffort: { options, default } }` — ⚠ PER MODEL, because Codex's supported
   *  efforts differ BETWEEN models and a runtime-level list would offer one the model refuses. */
  dimensions: Readonly<Record<string, ModelDimension>>;
  /** Other spellings the runtime accepts for THIS model (2026-09-22) — a legacy stored id, a
   *  launch alias. ⚠ MATCHED, NEVER OFFERED: {@link findModel} is how an old pick keeps its row. */
  aliases?: ReadonlyArray<string>;
}

export interface ModelCatalog {
  runtime: string;
  source: string | null;
  status: CatalogStatus;
  /** Why, in an operator's words. ⚠ NON-EMPTY ON A `ready` CATALOG IS A NOTE, NOT A FAILURE
   *  (a truncated page run, an absent default marker) — read the STATUS, never this string. */
  reason: string;
  models: ReadonlyArray<CatalogModel>;
  /** The id the runtime declares as its own default, or `null`. ⚠ DISPLAYED, NEVER PERSISTED
   *  on its own — see {@link catalogSelection}. */
  defaultId: string | null;
  dimensions: ReadonlyArray<string>;
  truncated: boolean;
}

/** Every runtime's catalog, keyed by runtime id. */
export type ModelCatalogs = Readonly<Record<string, ModelCatalog>>;

/** ⚠ Module-level so an absent map is the SAME identity every render. */
export const NO_CATALOGS: ModelCatalogs = Object.freeze({});
const NO_MODELS: ReadonlyArray<CatalogModel> = Object.freeze([]);
const NO_OPTIONS: ReadonlyArray<ModelDimensionOption> = Object.freeze([]);
const NO_DIMENSIONS: Readonly<Record<string, ModelDimension>> = Object.freeze({});
const NO_ALIASES: ReadonlyArray<string> = Object.freeze([]);

const REASONING_EFFORT = "reasoningEffort";

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * DOES THIS DESKTOP SPEAK THE CATALOG CONTRACT AT ALL?
 *
 * ⚠ AN OWN-KEY PROBE, THE IDIOM `permission-modes.ts › hasModelKey` SETS. A desktop older than
 * U6 omits `catalogs` entirely, and reading that absence as "every runtime has no models" would
 * empty every picker on a machine running three runtimes. The caller falls back to the DEFAULT
 * runtime's frozen list instead (`agent-models.ts`) — which is exactly what that build renders.
 * ⚠ `catalogs: {}` IS A REAL ANSWER and a different one: this desktop said, and registered nothing.
 */
export function hasCatalogKey(reply: unknown): boolean {
  if (!reply || typeof reply !== "object") return false;
  return Object.prototype.hasOwnProperty.call(reply, "catalogs");
}

/**
 * NARROW THE WIRE'S `catalogs` MAP.
 *
 * ⚠ A VERSION THIS BUNDLE DOES NOT KNOW IS IGNORED WHOLESALE, not partially read. The version is
 * on the REPLY (one per read) rather than per catalog, so it is passed in.
 */
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

/** One catalog. `null` when the entry carries no usable runtime id or no known status. */
export function normalizeCatalog(id: unknown, raw: unknown): ModelCatalog | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const runtime = str(row.runtime) || str(id);
  if (!runtime) return null;
  const status = str(row.status) as CatalogStatus;
  // ⚠ AN UNKNOWN STATUS IS NOT COERCED TO `ready`, AND NOT TO `unavailable` EITHER. A newer
  // desktop with a fifth state is telling this bundle something it cannot act on, and the honest
  // rendering of that is `loading` — "nothing to offer yet", which persists nothing and refuses
  // nothing. Coercing to `ready` would offer a list this build cannot vouch for.
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
    // ⚠ A DIMENSION WITH NO OPTIONS IS DROPPED, never rendered empty — F-390's shape is a
    // control that writes nowhere, and INVARIANTS §11 asks for ABSENT rather than blank.
    if (!options.length) continue;
    const fallback = str(row.default);
    out[key] = {
      options,
      default: options.some((o) => o.value === fallback) ? fallback : null,
    };
  }
  return Object.keys(out).length ? Object.freeze(out) : NO_DIMENSIONS;
}

// ── READING ONE RUNTIME'S CATALOG ────────────────────────────────────────────

/**
 * THE CATALOG FOR A RUNTIME, OR `null`.
 *
 * ⚠ **THERE IS NO "ELSE" ARM, AND THAT IS THE POINT.** A miss answers `null`, never the default
 * runtime's list — the plan's hardest invariant is that a catalog failure must never substitute
 * another runtime's models, and a fallback here would be exactly that substitution.
 */
export function catalogFor(
  catalogs: ModelCatalogs | null | undefined,
  runtimeId: string | null | undefined
): ModelCatalog | null {
  const id = str(runtimeId);
  if (!id || !catalogs) return null;
  return catalogs[id] ?? null;
}

/**
 * THE ENTRY AN ID NAMES — its own `id`, else one of its `aliases` (2026-09-22).
 *
 * ⚠ **WHY ALIASES EXIST: THE CLAUDE ROSTER WENT LIVE.** Its ids are the CLI's own now
 * (`claude-opus-5[1m]`), so a channel that stored `claude-opus-5` before that must still find the
 * row that IS that model, or its picker would show the stored id as a second, unlabelled option
 * beside the real one. The desktop names the spellings; nothing here knows a vendor's id.
 */
export function findModel(
  c: ModelCatalog | null | undefined,
  id: string | null | undefined
): CatalogModel | null {
  const wanted = str(id);
  if (!wanted || !c) return null;
  return c.models.find((m) => m.id === wanted)
    ?? c.models.find((m) => (m.aliases ?? NO_ALIASES).includes(wanted))
    ?? null;
}

/** `true` only when the catalog is a list an operator may pick from RIGHT NOW. */
export const catalogReady = (c: ModelCatalog | null | undefined): boolean =>
  c?.status === "ready";

/**
 * THE SENTENCE A SURFACE SHOWS, or `null` when there is nothing to say.
 *
 * ⚠ IT IS DRIVEN BY THE STATUS, NEVER BY `models.length`. An empty `loading` catalog has nothing
 * to explain (the platform default is showing and a read is on its way); an empty `unavailable`
 * one has everything to explain, and the desktop's own words are what it says.
 */
export function catalogReason(c: ModelCatalog | null | undefined): string | null {
  if (!c) return null;
  if (c.status === "loading") return null;
  return c.reason || null;
}

/**
 * THE MODELS AN ORDINARY PICKER MAY OFFER — visible members of a `ready` catalog, in the
 * RUNTIME'S OWN ORDER.
 *
 * ⚠ THE ORDER IS THE SERVER'S AND IS NEVER RE-SORTED: a ranking is something only the platform
 * holds, and Dopl imposing one would teach an operator an order the runtime does not have.
 * ⚠ `stale`, `unavailable` AND `loading` ALL OFFER NOTHING. That is the "a stale/unavailable id
 * cannot be NEWLY selected" rule, and it is one rule rather than three special cases.
 */
export function selectableModels(
  c: ModelCatalog | null | undefined
): ReadonlyArray<CatalogModel> {
  if (!catalogReady(c) || !c) return NO_MODELS;
  const visible = c.models.filter((m) => !m.hidden);
  return visible.length ? visible : NO_MODELS;
}

/** May this id be chosen NOW? ⚠ The gate for a select's options and for a submitted payload. */
export function canSelectModel(
  c: ModelCatalog | null | undefined,
  id: string | null | undefined
): boolean {
  const hit = findModel(c, id);
  return !!hit && selectableModels(c).some((m) => m.id === hit.id);
}

/**
 * WHAT TO DISPLAY FOR AN ID — the runtime's label, else the RAW ID.
 *
 * ⚠ **A RAW ID IS THE ANSWER, NOT A FALLBACK.** A historical session card naming a model that
 * left the roster after an upgrade must still say WHICH model it ran on; a blank chip there would
 * report "no model" about a session that had one (INVARIANTS §11). This reads a `stale` and an
 * `unavailable` catalog too, deliberately — labelling is not selecting.
 */
export function modelLabel(
  c: ModelCatalog | null | undefined,
  id: string | null | undefined
): string {
  const wanted = str(id);
  if (!wanted) return "";
  // ⚠ A MODEL THE RUNTIME DID NOT NAME RENDERS ITS RAW ID — never hidden, never blank.
  return findModel(c, wanted)?.label || wanted;
}

/** The glance word for a card chip, or `null` for "render no chip" (there is no id at all). */
export function modelShortLabel(
  c: ModelCatalog | null | undefined,
  id: string | null | undefined
): string | null {
  const wanted = str(id);
  if (!wanted) return null;
  return findModel(c, wanted)?.short || wanted;
}

/**
 * WHAT THE MODEL ROW SHOWS for a stored value — the display-versus-wire discipline, as a pure
 * function.
 *
 * ⚠ **OMISSION IS THE PLATFORM DEFAULT, AND DISPLAYING IT PERSISTS NOTHING.** A channel that
 * never chose SHOWS the runtime's declared default and STORES no model until somebody touches the
 * control; the wire still carries no `model` field, which is what every session did before a
 * picker existed. `agent-models.ts › agentModelSelection` is the same rule for the default runtime
 * on an older desktop.
 * ⚠ AN UNKNOWN STORED ID IS RETURNED AS ITSELF, never replaced by the default — see
 * {@link modelLabel}. The row can render it; {@link canSelectModel} is what stops it being
 * re-offered.
 */
export function catalogSelection(
  c: ModelCatalog | null | undefined,
  stored: string | null | undefined
): string {
  const trimmed = str(stored);
  // ⚠ A LEGACY SPELLING SHOWS AS THE ROW IT NAMES (2026-09-22); an unknown one as itself.
  if (trimmed) return findModel(c, trimmed)?.id ?? trimmed;
  return c?.defaultId ?? "";
}

/**
 * THE OPTIONS A SELECT MAY SHOW, given what is currently EFFECTIVE.
 *
 * ⚠ THE EXTRA OPTION IS THE CURRENT VALUE AND NOTHING ELSE — appended, never inserted into the
 * roster, and gone the moment the value is a member again. Without it a `SelectMenu` whose value
 * matches no option renders BLANK, so a channel pinned to a model that left the roster would show
 * an empty control where it has an answer.
 */
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

// ── MODEL-SCOPED DIMENSIONS (REASONING EFFORT) ───────────────────────────────

/**
 * ONE MODEL'S OPTIONS FOR A DIMENSION — empty when this model does not offer it.
 *
 * ⚠ **PER MODEL, NOT PER RUNTIME, AND THE DIFFERENCE IS THE WHOLE CONTROL.** Codex reports
 * `supportedReasoningEfforts` on each model and they DIFFER between models, so a control sourced
 * from the runtime's declared dimension would offer an effort the selected model refuses. The
 * plan's U6 scenario — "effort options change with the selected model" — is only satisfiable here.
 * ⚠ EMPTY ⇒ RENDER NO CONTROL (hide, never gray). It is not an empty dropdown.
 */
export function dimensionOptionsFor(
  c: ModelCatalog | null | undefined,
  modelId: string | null | undefined,
  dimension: string = REASONING_EFFORT
): ReadonlyArray<ModelDimensionOption> {
  const wanted = str(modelId) || c?.defaultId || "";
  if (!wanted) return NO_OPTIONS;
  return c?.models.find((m) => m.id === wanted)?.dimensions[dimension]?.options ?? NO_OPTIONS;
}

/** This model's own declared default for a dimension, or `null`. */
export function dimensionDefaultFor(
  c: ModelCatalog | null | undefined,
  modelId: string | null | undefined,
  dimension: string = REASONING_EFFORT
): string | null {
  const wanted = str(modelId) || c?.defaultId || "";
  if (!wanted) return null;
  return c?.models.find((m) => m.id === wanted)?.dimensions[dimension]?.default ?? null;
}

/**
 * THE VALUE A DIMENSION CARRIES AFTER THE MODEL MOVED — the normalization the plan asks for
 * ("reasoning effort stored per Codex model, or normalized when the newly-selected model does not
 * support the previous effort").
 *
 * ⚠ **THE ORDER IS KEEP → THIS MODEL'S OWN DEFAULT → ABSENT, AND THE LAST ARM IS NOT A FAILURE.**
 * `""` means no field on the wire, i.e. the platform's own pick, which is what every session did
 * before the control existed. Falling back to another model's effort, or to the previous one
 * unchecked, would spend a setting the selected model cannot honour.
 */
export function normalizeDimensionValue(
  c: ModelCatalog | null | undefined,
  modelId: string | null | undefined,
  current: string | null | undefined,
  dimension: string = REASONING_EFFORT
): string {
  const options = dimensionOptionsFor(c, modelId, dimension);
  if (!options.length) return "";
  const wanted = str(current);
  if (wanted && options.some((o) => o.value === wanted)) return wanted;
  return dimensionDefaultFor(c, modelId, dimension) ?? "";
}
