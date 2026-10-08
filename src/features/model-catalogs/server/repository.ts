import "server-only";

/**
 * `runtime_model_catalogs` reads and writes, TOLERANT OF THE TABLE NOT EXISTING YET (INVARIANTS §12:
 * a hot-path schema change ships with a missing-object fallback; reference impl
 * `channels/server/color-shared-compat.ts`).
 *
 * Before `20261116120000_runtime_model_catalogs.sql` is applied: a publish answers
 * `{ stored: false }` (the desktop just tries again next time) and a read answers `[]` (the glasses
 * menu falls back to launch history, exactly its behaviour before this table). Detected from the
 * ERROR, never a probe; remembered for 5 minutes, then the table is tried again, so applying the
 * migration heals with no deploy.
 */

import { supabaseAdmin } from "@/shared/supabase/admin";
import { PublishedModelSchema, type PublishCatalogInput, type StoredCatalog } from "../contract";

const TABLE = "runtime_model_catalogs";
const RECHECK_MS = 5 * 60 * 1000;

let missingUntil = 0;
let now: () => number = () => Date.now();

/** True when `error` says the database has no `runtime_model_catalogs` table. */
export function isMissingCatalogTable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  if (e.code !== "42P01" && e.code !== "PGRST205") return false;
  return [e.message, e.details, e.hint].some((s) => String(s ?? "").includes(TABLE));
}

const knownMissing = () => now() < missingUntil;
const noteMissing = () => {
  missingUntil = now() + RECHECK_MS;
};

/** Minimal client shape, so tests drive the real functions over a fake. */
export interface CatalogDb {
  from(table: string): {
    upsert(row: Record<string, unknown>, opts: { onConflict: string }): PromiseLike<{ error: unknown }>;
    select(columns: string): {
      eq(column: string, value: string): PromiseLike<{ data: unknown[] | null; error: unknown }>;
    };
  };
}

const db = (): CatalogDb => supabaseAdmin() as unknown as CatalogDb;

export async function upsertCatalog(
  userId: string,
  deviceId: string,
  input: PublishCatalogInput,
  client: CatalogDb = db()
): Promise<{ stored: boolean }> {
  if (knownMissing()) return { stored: false };
  const defaultId = input.models.find((m) => m.isDefault)?.id ?? null;
  const { error } = await client.from(TABLE).upsert(
    {
      user_id: userId,
      device_id: deviceId,
      runtime: input.runtime,
      models: input.models,
      default_id: defaultId,
      app_version: input.appVersion ?? null,
      published_at: new Date(now()).toISOString(),
    },
    { onConflict: "user_id,runtime,device_id" }
  );
  if (!error) return { stored: true };
  if (isMissingCatalogTable(error)) {
    noteMissing();
    return { stored: false };
  }
  throw new Error(`model catalog write failed: ${String((error as { message?: unknown }).message ?? error)}`);
}

export async function catalogsForUser(userId: string, client: CatalogDb = db()): Promise<StoredCatalog[]> {
  if (knownMissing()) return [];
  const { data, error } = await client
    .from(TABLE)
    .select("runtime, device_id, models, default_id, published_at")
    .eq("user_id", userId);
  if (error) {
    if (isMissingCatalogTable(error)) {
      noteMissing();
      return [];
    }
    throw new Error(`model catalog read failed: ${String((error as { message?: unknown }).message ?? error)}`);
  }
  const rows: StoredCatalog[] = [];
  for (const raw of (data ?? []) as Record<string, unknown>[]) {
    // Re-validated on the way OUT too: a row is replayed onto a device, so a bad one is dropped
    // rather than trusted because it got in once.
    const models = Array.isArray(raw.models)
      ? raw.models.flatMap((m) => {
          const parsed = PublishedModelSchema.safeParse(m);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
    if (
      typeof raw.runtime !== "string" ||
      typeof raw.device_id !== "string" ||
      typeof raw.published_at !== "string"
    ) {
      continue;
    }
    rows.push({
      runtime: raw.runtime,
      deviceId: raw.device_id,
      models,
      defaultId: typeof raw.default_id === "string" ? raw.default_id : null,
      publishedAt: raw.published_at,
    });
  }
  return rows;
}

/** Test seam: forget what was seen and pin the clock. */
export function __resetCatalogCompatForTests(clock?: () => number): void {
  missingUntil = 0;
  now = clock ?? (() => Date.now());
}
