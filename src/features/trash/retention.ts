/**
 * Trash retention window — the single source of truth for how long a
 * soft-deleted row survives before it is permanently purged, and the basis
 * for each Trash item's `purgesAt`. Imported by both the aggregation service
 * (`features/trash/server/service.ts`) and the daily purge cron
 * (`api/cron/purge-trash/route.ts`) so the knob never drifts.
 */
export const RETENTION_DAYS = 30;
