/**
 * The durable launch selection as the renderer reads it: main's versioned record
 * (`main/launch-selection.js`) — ONE permission level that each runtime applies in its own settings,
 * plus the runtime pick and the message axis. This narrows a value that crossed a process boundary;
 * it derives no runtime's settings (main sends each runtime's reading, `permissionLevels`).
 */

import { LAUNCH_PERMISSION_LEVELS } from "../schema-launch-modes";

export type PermissionLevel = (typeof LAUNCH_PERMISSION_LEVELS)[number];

/** One runtime's reading of one level: its own name for it and its own words (`never/danger-full-access`). */
export interface LevelSetting {
  label: string;
  setting: string;
}

/** `{ [runtimeId]: { [level]: LevelSetting } }`, off main's reply. */
export type PermissionLevels = Readonly<Record<string, Readonly<Partial<Record<PermissionLevel, LevelSetting>>>>>;

export interface LaunchSelection {
  /** The record version main wrote; echoed back on a defaults write, never invented. */
  v: number;
  /** `''` = the default adapter, never "no runtime". */
  runtime: string;
  /** Dopl's own axis; the one vocabulary that does not move with the runtime. */
  messages: string;
  /** The one permission control. */
  level: PermissionLevel;
  /** A migrated runtime's own level where it differs from `level`; a level write clears it. */
  byRuntime: Readonly<Record<string, PermissionLevel>>;
}

export interface LaunchSelectionRead {
  selection: LaunchSelection;
  /** Main's sentences for a record it narrowed. A note, never a failure of the read. */
  review: ReadonlyArray<string>;
}

const NO_OVERRIDES: Readonly<Record<string, PermissionLevel>> = Object.freeze({});
const NO_REVIEW: ReadonlyArray<string> = [];
const NO_LEVELS: PermissionLevels = Object.freeze({});

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const asLevel = (v: unknown): PermissionLevel | null =>
  (LAUNCH_PERMISSION_LEVELS as ReadonlyArray<string>).includes(str(v)) ? (str(v) as PermissionLevel) : null;

/** The selection an unconfigured channel resolves to: the restrictive one. */
export function emptySelection(): LaunchSelection {
  return { v: 0, runtime: "", messages: "ask", level: LAUNCH_PERMISSION_LEVELS[0], byRuntime: NO_OVERRIDES };
}

/**
 * The versioned record off a launch-posture or agent-defaults reply. The per-channel reply nests it
 * under `selection`; the defaults reply IS the record (`agent-defaults.js › effectiveDefaults`).
 * An unreadable level is Ask — the narrowest, never a wider one than main holds.
 */
export function readLaunchSelection(raw: unknown): LaunchSelectionRead {
  if (!raw || typeof raw !== "object") return { selection: emptySelection(), review: NO_REVIEW };
  const reply = raw as Record<string, unknown>;
  const nested = reply.selection;
  const record = (nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested
    : Object.prototype.hasOwnProperty.call(reply, "level") ? reply : null) as Record<string, unknown> | null;
  if (!record) return { selection: emptySelection(), review: NO_REVIEW };
  const byRuntime: Record<string, PermissionLevel> = {};
  const source = record.byRuntime;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [id, value] of Object.entries(source as Record<string, unknown>)) {
      const level = asLevel(value);
      if (level) byRuntime[str(id)] = level;
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
      level: asLevel(record.level) ?? LAUNCH_PERMISSION_LEVELS[0],
      byRuntime: Object.keys(byRuntime).length ? byRuntime : NO_OVERRIDES,
    },
    review: review.length ? review : NO_REVIEW,
  };
}

/** Main's per-runtime reading of each level, or `{}` from an older desktop. */
export function readPermissionLevels(raw: unknown): PermissionLevels {
  const table = raw && typeof raw === "object" ? (raw as { permissionLevels?: unknown }).permissionLevels : null;
  return table && typeof table === "object" && !Array.isArray(table) ? (table as PermissionLevels) : NO_LEVELS;
}

/** The level `runtimeId` launches at (`''` = the default adapter): its override, else the channel's. */
export function levelFor(selection: LaunchSelection, runtimeId: string, defaultRuntime: string): PermissionLevel {
  const id = str(runtimeId) || str(defaultRuntime);
  return (id && selection.byRuntime[id]) || selection.level;
}
