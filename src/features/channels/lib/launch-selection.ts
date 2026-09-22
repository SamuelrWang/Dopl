/**
 * THE DURABLE LAUNCH SELECTION, AS THE RENDERER READS IT — the web mirror of
 * `dopl-desktop-app/main/launch-selection.js`'s versioned, runtime-keyed record (2026-09-21, U5's
 * contract; consumed by U7/U8).
 *
 * ⚠ **WHY THE RENDERER NEEDS THE WHOLE RECORD AND NOT THE LEGACY PAIR.** The reply still carries
 * `{tools, messages, model}` for the SELECTED runtime — a compatibility window every renderer
 * older than U5 feature-probes (`permission-modes.ts › hasModelKey`) — but those three keys
 * cannot express the one thing U7 and U8 are about: **Claude's and Codex's settings sit side by
 * side and are never translated.** Switching Claude → Codex → Claude has to restore BOTH
 * remembered models and BOTH native sets, and a record with one global `model` field cannot hold
 * two rosters. `byRuntime` is that record.
 *
 * ⚠ **IT INTERPRETS NOTHING AND VALIDATES NOTHING.** Every vocabulary belongs to the selected
 * adapter's descriptor (`runtime-model-catalog.ts`, `runtime-native.ts`), and main re-validates
 * every write regardless — this module narrows a value that crossed a process boundary and says
 * which keys were present. A renderer that coerced a stored mode here would be a second
 * authority on a vocabulary it does not own.
 *
 * ⚠ **`selectionVersion` IS A CAPABILITY, NOT A VALUE.** A desktop older than U5 sends no
 * `selection` key at all, and reading that absence as "an empty record" would show every runtime
 * as unconfigured on a machine that has settings — INVARIANTS §11, UNKNOWN is not EMPTY.
 * {@link readLaunchSelection} answers `supported: false` there and the rows fall back to the
 * legacy pair.
 *
 * ⚠ NO HOOK, NO BRIDGE, NO REACT (INVARIANTS §1). The ONE reason this file changes is that the
 * stored record's shape changed.
 */

/** One runtime's half of a selection. ⚠ EVERY FIELD IS OMITTED WHEN ABSENT, never `""`/`null` —
 *  main's own rule, so "no pick" and "cleared" are ONE record rather than two states to get
 *  wrong. */
export interface RuntimeRecord {
  tools?: string;
  model?: string;
  native?: Readonly<Record<string, string>>;
}

export interface LaunchSelection {
  /** The record version main WROTE. ⚠ A renderer reading a different one must not assume shape. */
  v: number;
  /** `''` = the DEFAULT adapter, never "no runtime". */
  runtime: string;
  /** Dopl's own axis — the one vocabulary that does not move with the runtime. */
  messages: string;
  byRuntime: Readonly<Record<string, RuntimeRecord>>;
}

export interface LaunchSelectionRead {
  /** Did the reply carry the record at all? ⚠ FALSE IS AN OLDER DESKTOP, not an empty record. */
  supported: boolean;
  selection: LaunchSelection;
  /**
   * The sentences main attached for a record it could not fully honour — `[]` when there are
   * none. ⚠ **NEVER A FAILURE OF THE READ**: the settings a review describes are already the
   * NARROWER ones, so the operator is being told what changed under them, not that something
   * broke (`channel-dir-ipc.js › channels:getLaunchPosture` states the same rule from main's
   * side).
   */
  review: ReadonlyArray<string>;
}

const EMPTY_RECORDS: Readonly<Record<string, RuntimeRecord>> = Object.freeze({});
const NO_REVIEW: ReadonlyArray<string> = [];

/** The selection a channel nobody has configured resolves to. ⚠ THE RESTRICTIVE ONE. */
export function emptySelection(): LaunchSelection {
  return { v: 0, runtime: "", messages: "ask", byRuntime: EMPTY_RECORDS };
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function normalizeRecord(raw: unknown): RuntimeRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const out: RuntimeRecord = {};
  const tools = str(row.tools);
  if (tools) out.tools = tools;
  const model = str(row.model);
  if (model) out.model = model;
  if (row.native && typeof row.native === "object" && !Array.isArray(row.native)) {
    const native: Record<string, string> = {};
    for (const [key, value] of Object.entries(row.native as Record<string, unknown>)) {
      const v = str(value);
      if (v) native[str(key)] = v;
    }
    if (Object.keys(native).length) out.native = native;
  }
  return out;
}

/**
 * Read the versioned record off a launch-posture or agent-defaults reply.
 *
 * ⚠ **THE PROBE IS OWN-KEY ON `selection`, NOT TRUTHINESS**, for `hasModelKey`'s reason: a
 * current main with nothing stored still sends the record, and `!!reply.selection` would read
 * that as an older desktop and hide every per-runtime row.
 * ⚠ **TWO SHAPES, ONE READER.** The per-channel reply nests the record under `selection`; the
 * defaults reply IS the record (`agent-defaults.js › effectiveDefaults` returns `v` and
 * `byRuntime` at the top level), because that record is a launch selection plus one flag. Reading
 * both here is what keeps the two scopes rendering from one shape — which is U8's whole premise.
 */
export function readLaunchSelection(raw: unknown): LaunchSelectionRead {
  if (!raw || typeof raw !== "object") {
    return { supported: false, selection: emptySelection(), review: NO_REVIEW };
  }
  const reply = raw as Record<string, unknown>;
  const nested = Object.prototype.hasOwnProperty.call(reply, "selection")
    ? (reply.selection as Record<string, unknown> | null)
    : null;
  const record = nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested
    : Object.prototype.hasOwnProperty.call(reply, "byRuntime")
      ? reply
      : null;
  if (!record) {
    return { supported: false, selection: emptySelection(), review: NO_REVIEW };
  }
  const byRuntime: Record<string, RuntimeRecord> = {};
  const source = record.byRuntime;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [id, value] of Object.entries(source as Record<string, unknown>)) {
      const normalized = normalizeRecord(value);
      // ⚠ A RECORD FOR A RUNTIME THIS BUILD DOES NOT REGISTER IS KEPT AND NEVER READ — main's own
      // promise, applied on this side: a downgrade must not destroy what an upgrade stored, and a
      // row that cannot resolve a descriptor simply never renders.
      if (normalized) byRuntime[str(id)] = normalized;
    }
  }
  const version = Number(record.v);
  const review = Array.isArray(reply.needsReview)
    ? (reply.needsReview as unknown[]).map((line) => str(line)).filter((line) => line)
    : NO_REVIEW;
  return {
    supported: true,
    selection: {
      v: Number.isFinite(version) ? version : 0,
      runtime: str(record.runtime),
      messages: str(record.messages) || "ask",
      byRuntime,
    },
    review: review.length ? review : NO_REVIEW,
  };
}

const EMPTY_RECORD: RuntimeRecord = Object.freeze({});

/**
 * ONE RUNTIME'S RECORD — never null, possibly empty.
 *
 * ⚠ **`''` RESOLVES TO THE DEFAULT ADAPTER'S RECORD**, which is where a migrated legacy
 * `{tools, model}` landed (`launch-selection.js › fromLegacy` files it under the DEFAULT runtime
 * untranslated, because that is the only vocabulary the old validators could store). It is why
 * an old `accept_edits` is still Claude's value after the migration and is never shown on Codex.
 */
export function recordFor(
  selection: LaunchSelection,
  runtimeId: string,
  defaultRuntime: string
): RuntimeRecord {
  const id = str(runtimeId) || str(defaultRuntime);
  return selection.byRuntime[id] ?? (id ? EMPTY_RECORD : selection.byRuntime[""] ?? EMPTY_RECORD);
}
