-- ============================================================================
-- RUNTIME MODEL CATALOGS — the desktop's live model roster, published (2026-10-08)
-- ============================================================================
-- The glasses menu runs SERVER-side and the model roster lives on the DESKTOP (each runtime's
-- own CLI/SDK answers it). Until now nothing stored it server-side, so the lens could offer only
-- "Default" plus models this person had already launched. The desktop now publishes each
-- runtime's catalog after every live READY read and on a slow refresh tick
-- (`dopl-desktop-app/main/catalog-publish.js` → `POST /api/devices/model-catalog`), and
-- `glasses/core/menu/service.ts › launchOptions` reads it.
--
-- ONE ROW PER (user, runtime): the last desktop to publish wins. What is stored is LABELS and
-- DIMENSIONS only (id, label, short, isDefault, per-model dimension options) — no credentials,
-- account ids or paths; the route's schema (`features/model-catalogs/contract.ts`) refuses
-- anything else.
--
-- ADDITIVE ONLY. Service role writes; RLS on with an owner-only SELECT.
--
-- DEPLOY ORDER: not load-bearing. Before this is applied the publish route answers
-- `{ stored: false }` and the glasses menu falls back to launch history
-- (`features/model-catalogs/server/repository.ts`, missing-table tolerance, INVARIANTS §12).
--
-- Rollback:
--   DROP TABLE IF EXISTS public.runtime_model_catalogs;

CREATE TABLE IF NOT EXISTS public.runtime_model_catalogs (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  runtime text NOT NULL CHECK (runtime ~ '^[a-z][a-z0-9_-]{0,31}$'),
  models jsonb NOT NULL CHECK (jsonb_typeof(models) = 'array'),
  default_id text NULL CHECK (default_id IS NULL OR char_length(default_id) <= 100),
  app_version text NULL CHECK (app_version IS NULL OR char_length(app_version) <= 32),
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, runtime)
);

ALTER TABLE public.runtime_model_catalogs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS runtime_model_catalogs_owner_select ON public.runtime_model_catalogs;
CREATE POLICY runtime_model_catalogs_owner_select ON public.runtime_model_catalogs
  FOR SELECT USING (auth.uid() = user_id);
