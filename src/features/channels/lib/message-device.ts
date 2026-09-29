/**
 * **WHERE A MESSAGE CAME FROM, AND WHAT AN AGENT SHOWED WITH IT** — the two reserved,
 * server-written metadata keys the transcript reads (docs/specs/device-aware-messages.md,
 * docs/specs/unified-display.md).
 *
 * - `metadata.source` — the device a MEMBER posted from (`glasses` / `computer` / `web` / `phone`).
 * - `metadata.display` — a display (every decision too): read ONLY through the one adapter,
 *   {@link messageDisplayOf} → `display/core/adapt.ts › displayOf`.
 *
 * ⚠ **TOLERANT READERS, NEVER VALIDATORS.** A row this build cannot read returns `null` and the
 * transcript renders the plain body, which is why every display message carries a text fallback.
 */

import { displayOf } from "@/features/display/core/adapt";
import type { Display, DisplayAnswerStamp } from "@/features/display/core/types";

/** Open on purpose, like `devices/types.ts › DeviceKind`: a new kind renders generically. */
export type MessageSourceKind = "glasses" | "computer" | "web" | "phone" | (string & {});

export interface MessageSource {
  kind: MessageSourceKind;
  /** The registered device, when there is one — the UI prefers its LIVE name (a rename). */
  deviceId: string | null;
  /** The name at write time — the fallback when the device is gone or not the viewer's. */
  label: string;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

export function messageSourceOf(metadata: Json | null | undefined): MessageSource | null {
  const source = metadata?.source;
  if (!isObject(source)) return null;
  const kind = str(source.kind);
  const label = str(source.label);
  if (!kind || !label) return null;
  return { kind, deviceId: str(source.device_id), label };
}

/** The display on a message (v2, v1 or a legacy decision), or `null` — the body renders. */
export function messageDisplayOf(
  metadata: Json | null | undefined,
  pageAnswer?: DisplayAnswerStamp | null
): Display | null {
  return displayOf(metadata, { pageAnswer });
}
