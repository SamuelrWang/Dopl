/**
 * The durable launch selection as the renderer reads it: main's versioned, runtime-keyed record
 * (`main/launch-selection.js`). Each runtime's settings sit side by side, never translated. This
 * narrows a value that crossed a process boundary; it validates no vocabulary (main does).
 */

/** One runtime's half. Absent fields are omitted, never `""`/`null` (main's rule). */
export interface RuntimeRecord {
  tools?: string;
  native?: Readonly<Record<string, string>>;
}

export interface LaunchSelection {
  /** The record version main wrote; echoed back on a defaults write, never invented. */
  v: number;
  /** `''` = the default adapter, never "no runtime". */
  runtime: string;
  /** Dopl's own axis; the one vocabulary that does not move with the runtime. */
  messages: string;
  byRuntime: Readonly<Record<string, RuntimeRecord>>;
}

export interface LaunchSelectionRead {
  selection: LaunchSelection;
  /** Main's sentences for a record it narrowed. A note, never a failure of the read. */
  review: ReadonlyArray<string>;
}

const EMPTY_RECORDS: Readonly<Record<string, RuntimeRecord>> = Object.freeze({});
const NO_REVIEW: ReadonlyArray<string> = [];

/** The selection an unconfigured channel resolves to: the restrictive one. */
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
  // No `model`: channels store none.
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
 * The versioned record off a launch-posture or agent-defaults reply. The per-channel reply nests it
 * under `selection`; the defaults reply IS the record (`agent-defaults.js › effectiveDefaults`).
 */
export function readLaunchSelection(raw: unknown): LaunchSelectionRead {
  if (!raw || typeof raw !== "object") {
    return { selection: emptySelection(), review: NO_REVIEW };
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
    return { selection: emptySelection(), review: NO_REVIEW };
  }
  const byRuntime: Record<string, RuntimeRecord> = {};
  const source = record.byRuntime;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [id, value] of Object.entries(source as Record<string, unknown>)) {
      const normalized = normalizeRecord(value);
      // A record for an unregistered runtime is kept (main's rule) and simply never renders.
      if (normalized) byRuntime[str(id)] = normalized;
    }
  }
  const version = Number(record.v);
  const review = Array.isArray(reply.needsReview)
    ? (reply.needsReview as unknown[]).map((line) => str(line)).filter((line) => line)
    : NO_REVIEW;
  return {
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
 * One runtime's record, never null. ⚠ `''` resolves to the default adapter's record — the key main's
 * `activeRecord` reads, where a migrated legacy `{tools}` lives (`launch-selection.js › fromLegacy`).
 */
export function recordFor(
  selection: LaunchSelection,
  runtimeId: string,
  defaultRuntime: string
): RuntimeRecord {
  const id = str(runtimeId) || str(defaultRuntime);
  return (id && selection.byRuntime[id]) || EMPTY_RECORD;
}
