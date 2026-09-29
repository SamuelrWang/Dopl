-- DROP THE GLASSES PROTOTYPE LEFTOVERS (db-cleanup audit, 2026-09-28).
--
-- ⚠ HELD — WRITTEN, NOT APPLIED. Samuel's ruling for the audit: "List + draft
-- drops, don't apply". Release per supabase/migrations-held/README.md.
--
-- What and why (evidence measured 2026-09-28, docs/db-cleanup-audit.md):
--
--   1. TABLE public.glasses_devices — the single-device prototype, superseded by
--      glasses_device_links (20261028120000). No code in src/, packages/, apps/,
--      dopl-desktop-app/ or scripts/ reads or writes it (docs/glasses-mcp.md:
--      "no longer read"). 1 row; its last_seen stopped moving 2026-09-26, when
--      the device-links code replaced it. Dropping it also drops its
--      glasses_devices_owner_select policy. No FK, view or function references it.
--
--   2. POLICY glasses_messages_owner_update — lets a signed-in user UPDATE their
--      own glasses_messages rows (status / answer / payload) straight through
--      PostgREST, bypassing the server that owns that state machine. Every glasses
--      read and write is service-role (features/glasses repositories), which
--      bypasses RLS, so no code path uses this policy.
--
--   3. POLICY glasses_device_links_owner_select — exposes token_hash and
--      hey_even_key_hash to the owner's browser session. Nothing reads the table
--      with a user client. ⚠ If the Connect page's "Devices" panel ever lists
--      device links, it must do so through a server route that selects named
--      columns, not by re-adding this policy.
--
-- Kept, listed as needs-Samuel: glasses_messages_owner_select and
-- glasses_templates_owner_select (unused by code, but harmless reads of the
-- owner's own rows).
--
-- Precondition to release: none beyond the audit sign-off. Rollback: re-run the
-- CREATE POLICY statements from 20261025120000 / 20261028120000; the table's
-- one prototype row is not worth restoring.

DROP POLICY IF EXISTS glasses_messages_owner_update ON public.glasses_messages;
DROP POLICY IF EXISTS glasses_device_links_owner_select ON public.glasses_device_links;

DROP TABLE IF EXISTS public.glasses_devices;
