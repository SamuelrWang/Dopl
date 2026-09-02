-- **THE DELIVERY KEYSTONE** (2026-09-02, v2 wave A slice A9 — guardrails G6, G7,
-- G8, G11, G12, G15, G20).
--
-- ⚠ **WRITTEN, NOT APPLIED. REPLAY IS OWED.** Docker is unavailable in the
-- environment this was authored in, so `supabase db reset` has NOT been run
-- against it and this file has executed NOWHERE. Do not read the absence of an
-- error as evidence that it works.
-- ⚠ RE-DERIVE RATHER THAN TRUSTING THAT LINE, AND JOIN ON THE NAME:
-- `supabase migration list --linked` (or MCP `list_migrations`) plus a look at
-- the live columns. INVARIANTS §12; F-304's re-stamp is the precedent — a claim
-- of "not applied" on `channel_launch_directives` survived a fortnight after the
-- columns were live.
--
-- ⚠ READ `20260725120000_channels.sql` (the message row),
-- `20260909120000_channel_sessions_health.sql` (the projection this resolves
-- against) and `20260910120000_channel_launch_directives_posture.sql` (the
-- REQUEST trio and the machine's ECHO trio) before changing anything here. This
-- file adds a THIRD trio to that table and the distinction between the three is
-- the whole point — it is stated at section 3.
--
-- ── WHAT THIS FILE IS FOR ──────────────────────────────────────────────────
--
-- Until now the server stored a message with NO delivery semantics at all. Who a
-- message was for, and whether it woke anybody, was re-derived on every desktop
-- by parsing the BODY (`main/session-dispatch.js › mentionedAgentIds`) — so the
-- rule lived on the weakest build in the field, every reader could disagree with
-- every other, and an orchestrator that addressed an agent had no way to tell
-- "it landed and something is on it" from "it landed on nobody".
--
-- ⚠ **THE COLUMNS ARE ADDITIVE AND NULLABLE, AND `NULL` IS A REAL ANSWER
-- EVERYWHERE.** `NULL` means *this row predates the resolver, or the resolver
-- could not answer* — never "nobody" and never "no". Every reader is written
-- against that: `main/session-dispatch.js` falls back to its own body parse when
-- `recipient_agent_ids` is NULL, which is what keeps an installed desktop and a
-- back-filled-by-nothing history working unchanged.
--
-- ⚠ **ROLLBACK IS A `DROP COLUMN` ON COLUMNS NOTHING ELSE READS.** Nothing here
-- is NOT NULL and no CHECK constrains an existing row, so reverting the code
-- leaves the columns inert rather than breaking an insert. That is why the
-- "non-null applied posture" G6 asks for is non-null BY CONSTRUCTION (the
-- service always writes it, `service-launch.test.ts` pins it) rather than by a
-- constraint that would 500 every insert from a rolled-back build.
-- ⚠ AND A `NOT NULL` ON `resolved_*` WAS RECONSIDERED ON 2026-09-02 (review D4)
-- AND REFUSED, for a second reason on top of that one: `NULL` there means "this
-- channel records no ceiling on that axis", which is EVERY channel today —
-- `channels.agent_*` has no editing surface (F-449). A NOT NULL would 500 every
-- launch rather than record anything. The honest non-null is the one the service
-- writes where a ceiling exists, and the ledger says exactly that.

-- ═══ 1. `channel_messages` — WHO IT WAS FOR, AND WHAT HAPPENED ═════════════

-- WHO. The server's own resolution of the recipient, computed at write time by
-- `src/features/channels/server/service-wake-verdict.ts › resolveWakeVerdict`.
--   'member'  — `to=` named a channel member (already membership-checked).
--   'agent'   — the body named at least one live agent session the server could
--               resolve in `channel_sessions`.
--   'thread'  — no named recipient, but the post carries a thread tag: it
--               reaches sessions already working that thread and wakes nobody.
--   'none'    — it addresses nobody.
ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS wake_verdict TEXT;

ALTER TABLE public.channel_messages
  DROP CONSTRAINT IF EXISTS channel_messages_wake_verdict_check;
-- ⚠ RE-CREATED WHOLE, NOT EDITED — a CHECK cannot be ALTERed, and a
-- partially-rewritten one is how a clause goes missing.
ALTER TABLE public.channel_messages
  ADD CONSTRAINT channel_messages_wake_verdict_check
  CHECK (wake_verdict IS NULL OR wake_verdict IN ('none', 'member', 'agent', 'thread'));

-- WHICH. The ids the verdict resolved to. Empty array and NULL are DIFFERENT
-- answers: `{}` is "the resolver ran and found none", NULL is "the resolver did
-- not run". The desktop's fallback keys on the second.
ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS recipient_user_ids UUID[];

-- ⚠ TEXT[], NOT UUID[]. An agent id is minted on a desktop
-- (`main/agent-id.js`) and is `[a-z][a-z0-9]{7}` — eight characters, not a UUID.
-- It is also the value of `channel_sessions.name`, whose own CHECK is
-- `^[a-z][a-z0-9-]{1,30}$`, so this column carries the same vocabulary that
-- projection does and no other.
ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS recipient_agent_ids TEXT[];

-- WHAT HAPPENED. ONE vocabulary for the outcome, written twice by two authors:
-- the SERVER stamps its best answer at write time, and the operator's machine
-- OVERWRITES it with what it actually did (`delivery_at` stamped with it). A row
-- whose `delivery_at` is NULL carries the server's write-time answer and nothing
-- has confirmed it.
--   'none'         nothing was addressed.
--   'unreachable'  the body named an agent and it resolved to no live session.
--   'idle'         it reached sessions already on the thread; nobody was woken.
--   'delivered'    it reached its recipient; whether anything runs is their side.
--   'woken'        a dormant agent was started on it.
--   'refused'      the machine declined to feed it (a full queue, a gate).
ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS delivery TEXT;

ALTER TABLE public.channel_messages
  DROP CONSTRAINT IF EXISTS channel_messages_delivery_check;
ALTER TABLE public.channel_messages
  ADD CONSTRAINT channel_messages_delivery_check
  CHECK (
    delivery IS NULL
    OR delivery IN ('none', 'unreachable', 'idle', 'delivered', 'woken', 'refused')
  );

ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS delivery_at TIMESTAMPTZ;

COMMENT ON COLUMN public.channel_messages.wake_verdict IS
  'WHO the server resolved this message for at write time: none | member | agent | thread. NULL = written before the resolver existed. Never re-computed on read.';
COMMENT ON COLUMN public.channel_messages.recipient_user_ids IS
  'The member ids the verdict resolved to. ⚠ {} and NULL differ: {} is "resolved to nobody", NULL is "not resolved here" — the desktop falls back to its own body parse only on NULL.';
COMMENT ON COLUMN public.channel_messages.recipient_agent_ids IS
  'The live agent ids the verdict resolved to, from channel_sessions.name. ⚠ {} vs NULL as above.';
COMMENT ON COLUMN public.channel_messages.delivery IS
  'The OUTCOME: none | unreachable | idle | delivered | woken | refused. The server stamps its write-time answer; the operator''s machine overwrites it with what it did and stamps delivery_at. ⚠ delivery_at NULL means nothing has confirmed the server''s answer.';
COMMENT ON COLUMN public.channel_messages.delivery_at IS
  'When the operator''s machine acknowledged delivery. NULL = never acknowledged; the delivery column is then the server''s own write-time verdict.';

-- ═══ 2. `channels` — THE POSTURE CEILING THE SERVER CAN SEE (G6, G7) ═══════
--
-- ⚠ **THE CEILING WAS DESKTOP-ONLY AND THAT IS THE WHOLE GAP.** It lives in an
-- `electron-store` record (`main/channel-prefs.js › getLaunchPosture`,
-- `AGENT_CHAIN_KEY = 'channelAgentChain'`) that no server has ever seen, so
-- `20260910120000`'s own header could only say the request "decides nothing" and
-- leave every clamp to the machine. An offline or older desktop therefore
-- enforced nothing at all, which is exactly what G6/G7 record.
--
-- ⚠ **NULL MEANS "NO CEILING IS RECORDED HERE", NOT "UNRESTRICTED".** The server
-- clamps and refuses only against a ceiling it actually holds; the desktop's own
-- clamp (`main/launch-posture.js`) stays the belt on every path and is NOT
-- removed by this file. A channel that has never had a ceiling written behaves
-- exactly as it does today, which is what makes this additive.
--
-- ⚠ **IT IS A CHANNEL PROPERTY, NOT A MEMBER ONE, AND THE WRITE IS
-- MANAGE-GATED** (`service-writes.ts › updateChannel`, `MANAGED_CHANNEL_FIELDS`).
-- A per-member ceiling would be a `channel_members` column and a `my*` name — do
-- not quietly reinterpret these three.
ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS agent_tool_ceiling TEXT;

ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS agent_message_ceiling TEXT;

ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS agent_chain_allowed BOOLEAN;

ALTER TABLE public.channels
  DROP CONSTRAINT IF EXISTS channels_agent_ceiling_check;
-- ⚠ ONE CONSTRAINT OVER BOTH AXES, on `20260910120000`'s precedent: the rule
-- belongs to the AXIS and two columns happen to carry it. The value lists are
-- the same closed enums that file CHECKs, and they are ORDERED NARROWEST-FIRST
-- in `main/launch-posture.js › narrowTo`, which is not a fact a CHECK can carry —
-- re-ordering that array silently inverts the clamp.
ALTER TABLE public.channels
  ADD CONSTRAINT channels_agent_ceiling_check
  CHECK (
    (agent_tool_ceiling IS NULL
      OR agent_tool_ceiling IN ('manual', 'accept_edits', 'auto', 'bypass'))
    AND (agent_message_ceiling IS NULL
      OR agent_message_ceiling IN ('ask', 'auto_inbound', 'auto_outbound', 'auto_both'))
  );

COMMENT ON COLUMN public.channels.agent_tool_ceiling IS
  'CEILING: the widest TOOL mode a launch directive filed into this channel may ask for. ⚠ NULL = no ceiling recorded server-side; the desktop''s own stored posture is then the only clamp, exactly as before this column existed.';
COMMENT ON COLUMN public.channels.agent_message_ceiling IS
  'CEILING: the widest MESSAGE mode a launch directive may ask for. ⚠ NULL as above.';
COMMENT ON COLUMN public.channels.agent_chain_allowed IS
  'CEILING: may an agent launched here launch further agents? FALSE refuses `chain: true` at directive creation (G7). ⚠ NULL = not recorded; the desktop''s `channelAgentChain` toggle is then the only answer.';

-- ═══ 3. `channel_launch_directives` — THE SERVER'S RESOLVED POSTURE ════════
--
-- ⚠ **THIS IS THE THIRD TRIO ON THIS TABLE AND THE THREE ARE NOT
-- INTERCHANGEABLE.** Reading one as another is the defect this comment exists to
-- prevent:
--   `start_*` / `chain`        THE REQUEST — what the caller ASKED for. NULL =
--                              did not ask. Never rewritten.
--   `applied_*`                THE MACHINE'S ECHO — what the desktop says it
--                              actually applied. NULL = NOT REPORTED. Still has
--                              no writer; `20260910120000` says so and it is
--                              still true.
--   `resolved_*` (here)        THE SERVER'S ANSWER — the request clamped to the
--                              channel ceiling above, decided at CREATION and
--                              written on EVERY create. ⚠ NULL HAS EXACTLY ONE
--                              MEANING HERE (corrected 2026-09-02, review D4):
--                              **no ceiling is recorded on that axis of this
--                              channel**, so the server has nothing to state and
--                              the machine's own stored pair is the only answer.
--                              It does NOT mean "the caller did not ask" — an
--                              unasked axis takes the ceiling
--                              (`lib/agent-posture.ts › narrowTo`), which is what
--                              `main/launch-posture.js › resolvePosture` has
--                              always done with its own pair.
--
-- ⚠ **`resolved_*` IS NOT A PROMISE ABOUT THE RUN.** The server starts nothing
-- (`service-launch.ts`'s header). It is the answer to "what did the SERVER
-- permit", which is the half that was previously unanswerable and is what G6
-- means by making the applied value non-null. The machine may still narrow
-- further — its own ceiling is finer-grained and it owns the windowless floor —
-- and when it reports that, `applied_*` is where it goes.
ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS resolved_tool_mode TEXT;

ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS resolved_message_mode TEXT;

ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS resolved_chain BOOLEAN;

-- ⚠ THE MODEL IS ECHOED, NEVER REFUSED (G8), AND THAT IS A DECISION WITH A
-- REASON RATHER THAN A SHORTCUT. `src/features/channels/lib/agent-models.ts ›
-- normalizeAgentModel` states the rule this follows: *"a main running a newer
-- model must not have its answer erased by a web build that predates it"*, and
-- the desktop additionally accepts ALIASES (`main/session-model.js ›
-- MODEL_CHOICES`) and `[1m]` long-context variants. A server-side 400 on an
-- unknown id would refuse values the machine runs happily — a narrowing nobody
-- ruled. So this column carries the CANONICAL id when the server recognises the
-- request, and NULL when it does not; NULL is what the result line renders as
-- "unrecognised — your machine decides", which is the fact G8 says nothing tells
-- the caller today.
ALTER TABLE public.channel_launch_directives
  ADD COLUMN IF NOT EXISTS resolved_model TEXT;

ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_resolved_check;
ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_resolved_check
  CHECK (
    (resolved_tool_mode IS NULL
      OR resolved_tool_mode IN ('manual', 'accept_edits', 'auto', 'bypass'))
    AND (resolved_message_mode IS NULL
      OR resolved_message_mode IN ('ask', 'auto_inbound', 'auto_outbound', 'auto_both'))
  );

COMMENT ON COLUMN public.channel_launch_directives.resolved_tool_mode IS
  'SERVER-RESOLVED: the requested TOOL mode clamped to channels.agent_tool_ceiling. Written on every create. ⚠ NOT applied_tool_mode — that is the machine''s echo and still has no writer.';
COMMENT ON COLUMN public.channel_launch_directives.resolved_message_mode IS
  'SERVER-RESOLVED: the requested MESSAGE mode clamped to channels.agent_message_ceiling. ⚠ See resolved_tool_mode.';
COMMENT ON COLUMN public.channel_launch_directives.resolved_chain IS
  'SERVER-RESOLVED chaining. ⚠ `chain: true` against a channel whose agent_chain_allowed is FALSE is REFUSED at creation (400), never clamped — a clamped chain produces an agent that hits a bound mid-run. So this is TRUE only when the ceiling permitted it.';
COMMENT ON COLUMN public.channel_launch_directives.resolved_model IS
  'SERVER-RESOLVED model: the canonical id the requested value resolved to, or NULL when the server does not recognise it. ⚠ NULL is NOT a refusal — an unknown id is carried to the machine unchanged; see this migration''s section 3.';

-- ═══ 4. `channel_message_insert` — THE RPC LEARNS THE FOUR COLUMNS ═════════
--
-- ⚠ **THE INSERT IS AN RPC AND NOT A PLAIN `INSERT`, FOR A REASON THAT STILL
-- HOLDS** — `20260725130000_channels_rls_hardening.sql` H1: it takes a
-- per-channel advisory xact lock so `seq` COMMIT order is monotonic per channel,
-- which is what stops an await cursor permanently skipping a message. So the new
-- columns have to be written THROUGH it; a second statement writing them
-- afterwards would be a second round trip and a window in which a realtime
-- subscriber sees the row without its verdict.
--
-- ⚠ **DROP-THEN-CREATE, NOT AN OVERLOAD.** `CREATE OR REPLACE` with extra
-- parameters creates a SECOND function rather than replacing the first, and two
-- functions with one name is exactly the drift this tree has paid for elsewhere.
-- The four new parameters DEFAULT NULL, so a rolled-back build calling with the
-- original eight NAMED arguments (which is how PostgREST calls) still resolves.
DROP FUNCTION IF EXISTS public.channel_message_insert(
  uuid, uuid, uuid, text, text, text, jsonb, text
);

CREATE OR REPLACE FUNCTION public.channel_message_insert(
  p_channel_id          uuid,
  p_workspace_id        uuid,
  p_author_user_id      uuid,
  p_author_kind         text,
  p_kind                text,
  p_body                text,
  p_metadata            jsonb,
  p_client_msg_id       text,
  p_wake_verdict        text    DEFAULT NULL,
  p_recipient_user_ids  uuid[]  DEFAULT NULL,
  p_recipient_agent_ids text[]  DEFAULT NULL,
  p_delivery            text    DEFAULT NULL
)
  RETURNS public.channel_messages
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
DECLARE
  result public.channel_messages;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_channel_id::text, 0));

  INSERT INTO public.channel_messages (
    channel_id, workspace_id, author_user_id, author_kind,
    kind, body, metadata, client_msg_id,
    wake_verdict, recipient_user_ids, recipient_agent_ids, delivery
  ) VALUES (
    p_channel_id, p_workspace_id, p_author_user_id, p_author_kind,
    p_kind, p_body, p_metadata, p_client_msg_id,
    p_wake_verdict, p_recipient_user_ids, p_recipient_agent_ids, p_delivery
  )
  RETURNING * INTO result;

  RETURN result;
END;
$function$;

-- ⚠ THE GRANT IS RE-STATED BECAUSE THE DROP TOOK IT WITH THE OLD SIGNATURE.
-- `service_role` only — the app's sole writer, same contract as before.
REVOKE ALL ON FUNCTION public.channel_message_insert(
  uuid, uuid, uuid, text, text, text, jsonb, text, text, uuid[], text[], text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channel_message_insert(
  uuid, uuid, uuid, text, text, text, jsonb, text, text, uuid[], text[], text
) TO service_role;
