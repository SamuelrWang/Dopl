/**
 * THE PUBLISHED MODEL CATALOG — what a desktop sends and what the server keeps (2026-10-08).
 *
 * LABELS AND DIMENSIONS ONLY. The desktop's catalog (`dopl-desktop-app/main/runtime/model-catalog.js`)
 * carries more (aliases, a launch spelling, a roster key fingerprinted from the sign-in); none of
 * that crosses. This schema is the fence: an unknown key is dropped, oversize input is refused.
 */

import { z } from "zod";

const ID = z.string().trim().min(1).max(100).regex(/^\S+$/);
const TEXT = z.string().trim().min(1).max(80);

const DimensionSchema = z.object({
  options: z
    .array(z.object({ value: z.string().trim().min(1).max(40), label: z.string().trim().min(1).max(60) }))
    .min(1)
    .max(12),
  default: z.string().trim().max(40).nullable().optional(),
});

export const PublishedModelSchema = z.object({
  id: ID,
  label: TEXT.nullable().optional(),
  short: TEXT.nullable().optional(),
  isDefault: z.boolean().optional(),
  dimensions: z.record(z.string().trim().min(1).max(32), DimensionSchema).optional(),
});

export const PublishCatalogSchema = z.object({
  runtime: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  models: z.array(PublishedModelSchema).min(1).max(100),
  appVersion: z.string().trim().max(32).optional(),
});

export type PublishedModel = z.infer<typeof PublishedModelSchema>;
export type PublishCatalogInput = z.infer<typeof PublishCatalogSchema>;

export interface StoredCatalog {
  runtime: string;
  /** The publishing computer (`desktop_devices.id`). One row per (user, runtime, computer). */
  deviceId: string;
  models: PublishedModel[];
  defaultId: string | null;
  publishedAt: string;
}

/** A catalog older than this is shown, but marked stale. The desktop republishes every 6h. */
export const CATALOG_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** A runtime a computer stopped publishing while it kept publishing others is gone there. */
export const CATALOG_LAGGING_MS = 24 * 60 * 60 * 1000;

/**
 * Is this runtime's catalog still its computer's word? Stale when it is old, or when THE SAME
 * computer has published OTHER runtimes well after it (the runtime is no longer ready there).
 * ⚠ `newestPublishMs` is that computer's newest publish, never the user's: a quiet second Mac
 * must not mark a busy one's list stale, nor the other way round.
 */
export function catalogIsStale(row: StoredCatalog, newestPublishMs: number, nowMs: number): boolean {
  const at = Date.parse(row.publishedAt);
  if (!Number.isFinite(at)) return true;
  return nowMs - at > CATALOG_STALE_AFTER_MS || newestPublishMs - at > CATALOG_LAGGING_MS;
}
