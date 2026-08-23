-- Retire the INBOUND consent lane and drop agent_trust_rules (2026-08-22).
--
-- Samuel's ruling: "remove all the stuff about declining and approving of
-- threads." Consent was symmetric — approve-in AND approve-out. The INBOUND
-- half ("a teammate's agent addressed you; Allow or Deny before your machine
-- spawns") is gone: a peer's ask NOTIFIES the operator, and the operator
-- launches a session or does not. There is no row to decide, so there is
-- nothing to decline.
--
-- OUTBOUND REVIEW IS UNTOUCHED, and this file must not be read as retiring
-- consent. `channel_consent_requests` keeps its table, its columns, its partial
-- unique de-dupe index (`channel_consent_requests_trigger_key`, which still
-- keys on `kind`) and its RLS. The operator's own agent drafts a reply and a
-- human Sends it before it leaves the machine — that is the whole of what the
-- table is for now.
--
-- ⚠ WRITTEN, NOT APPLIED. The tree holds the file; only the database holds the
-- answer (INVARIANTS §12). Replay is the gate:  supabase db reset  → exit 0.
--
-- ⚠ ORDER MATTERS INSIDE THIS FILE. Step 1 expires stale pending inbound rows
-- while `agent_trust_rules` still exists, so the sweep is readable against the
-- schema it describes. Step 2 then drops the table.


-- ---------------------------------------------------------------------------
-- 1. channel_consent_requests — expire the STALE PENDING inbound rows
-- ---------------------------------------------------------------------------
-- ⚠ EXPIRE, NEVER DELETE, AND ONLY THE PENDING ONES. Two different kinds of row
-- are involved and they are treated differently on purpose:
--
--   * DECIDED inbound rows (allowed / denied / expired / auto_allowed) ARE
--     KEPT, untouched. They are the audit trail of decisions real humans made,
--     and a retirement that rewrites the record is worse than the lane it
--     retired. `listConsentRequests(status='decided'|'all')` still returns them
--     and the DTO still hydrates `requester_user_id`.
--
--   * PENDING inbound rows are moved to 'expired', because NOTHING CAN DECIDE
--     THEM ANY MORE. The desktop dialog that answered one is deleted, the
--     create path that would re-raise one is deleted, and
--     `ConsentCreateSchema` no longer accepts kind='inbound'. Left pending they
--     are prompts with no surface: they would sit in the operator's inbox
--     forever, and `expireStalePending` only sweeps rows whose `expires_at` has
--     elapsed — a row born auto_allowed carries a NULL `expires_at` and would
--     never be reached at all.
--
-- `status = 'expired'` is the existing terminal the desktop watcher already
-- maps (`mapStatus` → 'expire' → `inboundExpired`), so no client learns a new
-- value from this. `decided_at` records WHEN the lane closed; `decided_by` is
-- left alone — nobody decided these, and writing a surface name would invent a
-- human who never clicked.
UPDATE public.channel_consent_requests
   SET status = 'expired',
       decided_at = now()
 WHERE kind = 'inbound'
   AND status = 'pending';


-- ---------------------------------------------------------------------------
-- 2. agent_trust_rules — DROP the table
-- ---------------------------------------------------------------------------
-- The table is INBOUND-ONLY by its own schema comment
-- (`20260726110000_agent_trust_rules.sql`): "a rule means the operator
-- auto-allows INBOUND consent requests … It NEVER affects outbound review."
-- With the inbound lane retired there is nothing left for a standing rule to
-- grant, so the whole thing goes rather than staying as a table with no reader.
--
-- ⚠ IT NEVER FIRED. `auto_allowed` is written in exactly one place — the trust
-- branch of `createConsentRequest` — and the surface that would have created a
-- rule was ON HOLD by Samuel's own ruling (INVARIANTS §6: "TRUST IS NOT IN THE
-- LAUNCH FLOW, deliberately"), so no rule was ever written and no consent row
-- was ever born auto-allowed. Measured zero `auto_allowed` rows in the table's
-- history before writing this; that is a MEASUREMENT, so re-run it rather than
-- trusting this sentence:
--   SELECT count(*) FROM channel_consent_requests WHERE status = 'auto_allowed';
--   SELECT count(*) FROM agent_trust_rules;
-- ⚠ If either comes back non-zero, STOP and re-decide: this file would then be
-- dropping evidence of grants that really happened, and step 1 above would need
-- to preserve them the way it preserves the decided rows.
--
-- CASCADE is not needed and is not used: nothing references this table. Its own
-- three FKs point OUT (auth.users twice, workspaces once), its policies and
-- indexes go with the table, and no view, trigger or function reads it —
-- `grep -rn agent_trust_rules supabase/ src/` returns this file, the creating
-- migration, the generated `src/shared/supabase/types.ts` and tombstone
-- comments. A plain DROP will therefore succeed, and if it does not, the error
-- is naming a dependency this paragraph is wrong about.
--
-- ⚠ NOT `IF EXISTS`. The table is in the baseline's successors and must be
-- there when this replays; a silent no-op would hide a migration history that
-- had already diverged.
DROP TABLE public.agent_trust_rules;


-- ---------------------------------------------------------------------------
-- What is deliberately NOT here
-- ---------------------------------------------------------------------------
-- * No change to `channel_consent_requests.kind`. There is no CHECK constraint
--   on that column to narrow, and adding one to forbid 'inbound' would refuse
--   the rows this file just preserved. The refusal lives at the SCHEMA
--   (`schema-collab.ts › ConsentCreateSchema` accepts only 'outbound'), which
--   is where a 400 can carry a reason.
-- * No change to the `status` domain. `auto_allowed` stays a legal value so a
--   stored row still reads; it simply has no writer left.
-- * No change to `requester_user_id`. The column has no writer any more and is
--   still RENDERED for the decided inbound rows step 1 preserved — the same
--   rule the reserved metadata keys follow in
--   `service-writes-metadata.ts`: a column something reads is not dead.
-- * No DOWN migration. This tree does not write them; the rollback for step 2
--   is `20260726110000_agent_trust_rules.sql` replayed, and step 1 is not
--   reversible by design (an expired prompt must not become live again).
