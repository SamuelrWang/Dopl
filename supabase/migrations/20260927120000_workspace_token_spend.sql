-- ============================================================================
-- TOKEN SPEND — THE PER-RUN LEDGER BEHIND OVERVIEW'S "tokens spent over time"
-- (Samuel, Mobile Command Center #1326: "right now on agents we see the token
-- spend number… it'd be really cool to track over time how many tokens were
-- spent on agents and have that be persistent knowledge in the overview").
-- ============================================================================
--
-- ⚠ **WHAT THE NUMBER IS AND WHERE IT COMES FROM.** `s.tokensSpent` on the
-- desktop (`dopl-desktop-app/main/session-io.js`, on every `result` event —
-- one completed TURN) is a session's LIFETIME accumulation. It already reaches
-- this server: `session-state-push.js › reportRow` picks it by name into
-- `channel_sessions.tokens_spent`, quantized to 10 000-token buckets by
-- `session-telemetry.js › quantizeTokens`.
--
-- ⚠ **SO THE NUMBER WAS NEVER MISSING — ITS ROW WAS DELETED.**
-- `channel_sessions` is a PROJECTION of what is running now, written by a
-- WHOLE-SET REPLACE: "a session's row exists while its PILL does and is DELETED
-- when the pill leaves" (`session-state-push.js › ROW LIFETIME`). The lifetime
-- figure is therefore correct right up to the moment it is thrown away. THIS
-- table is the durable half, and it is deliberately a SECOND table rather than
-- a widening of that one: making `channel_sessions` rows survive would break
-- the replace protocol every reader of that table depends on.
--
-- ── THE SHAPE, AND WHY IT IS ONE ROW PER RUN ────────────────────────────────
--
-- ⚠ **ONE ROW PER SESSION RUN, HOLDING THAT RUN'S HIGH-WATER MARK** — not a
-- per-day counter that pushes add into. The reports arriving here are
-- CUMULATIVE ("this run has spent N so far"), and turning a cumulative report
-- into an incremented counter needs a remembered watermark anyway. Keeping the
-- watermark AS the stored row makes the write idempotent by construction:
-- re-reporting the same figure stores the same figure. A retry, a coalesced
-- push, a duplicate delivery and an out-of-order arrival all cost nothing, and
-- **no arithmetic in this feature can double-count**, which is the one failure
-- a spend display cannot recover from.
--
-- ⚠ **`started_at` IS IN THE KEY, AND IT IS WHAT MAKES A NEW RUN A NEW ROW.**
-- `session_key` is the STABLE (channel, thread, agent) key — it is REUSED by
-- the next session on the same thread, whose `tokensSpent` starts again at
-- zero. Keyed on `session_key` alone, that restart would look like a counter
-- going backwards, and every "did it reset or is this stale?" heuristic gets
-- that guess wrong in one direction or the other. `started_at` is stamped once
-- when the engine builds the session object and never moves (it survives a
-- park/resume and is quantization-exempt — `session-telemetry.js`), so a new
-- run simply lands in a new row and the ambiguity does not exist.
--
-- ⚠ **DAYS ARE DERIVED, NOT STORED.** The row carries the run's own
-- `started_at`, so the reader buckets by LOCAL day (the precedent is
-- `channels-v2/thread-activity.tsx › ThreadActivityStrip`, 31 local-day
-- buckets). Storing a `spend_date` would have frozen one time zone into the
-- ledger, and a stored UTC day is the wrong bucket for most of the operators
-- who read it.
--
-- ⚠ **THE FIGURE IS A FLOOR, AND EVERY SURFACE MUST SAY SO RATHER THAN IMPLY
-- PRECISION.** Two known, deliberate under-counts, both inherited:
--   1. QUANTIZATION — the wire value is floored to 10 000 (`TOKENS_BUCKET`), so
--      a run is recorded at up to one bucket less than it spent.
--   2. THE FINAL STRETCH — `session-state-push.js › liveForWire` drops ENDED
--      rows before they are sent, so whatever a run spends after its last live
--      push is never reported. Bounded by one push interval, not by the run.
-- Both round DOWN. "At least this many tokens" is always true of this table;
-- "exactly this many" never is. ⚠ A future wave that wants the exact end
-- figure must ADD a final report on the ended path — it cannot get it by
-- reading this table more cleverly.
--
-- GROWTH: one row per session run, forever. That is far below `mcp_tool_calls`
-- (one row per loopback REQUEST) and this table is not on any hot path — it is
-- written a handful of times per session, on a push that was already happening.
--
-- ROLLBACK: `DROP FUNCTION record_token_spend(uuid, uuid, jsonb);` then
-- `DROP TABLE public.workspace_token_spend;`. Nothing else reads either, and no
-- session, message or billing row is touched by this feature.
-- ============================================================================

-- ── 1. The ledger ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_token_spend (
  -- ⚠ DENORMALIZED FROM THE CHANNEL like `channel_artifacts.workspace_id`, so
  -- every tenancy filter reads the container without a join.
  workspace_id uuid NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- ⚠ WHOSE MACHINE SPENT IT. This is also the ACCOUNT-WIDE read's whole fence:
  -- Overview is an account surface that spans containers, and "my agents'
  -- spend" is answered by this column alone — no membership set to assemble and
  -- no way to read a peer's rows.
  user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The desktop's stable (channel, thread, agent) key. TEXT and unvalidated
  -- here for the same reason `channel_sessions.session_key` is: it is a key the
  -- machine mints, not a reference this database can resolve.
  session_key text NOT NULL
    CONSTRAINT workspace_token_spend_key_bounded
      CHECK (length(session_key) BETWEEN 1 AND 200),
  -- ⚠ THE RUN'S IDENTITY (see the header). NOT NULL: a report with no
  -- `started_at` cannot be attributed to a run and is DROPPED by the service
  -- rather than merged into another run's row.
  started_at timestamptz NOT NULL,

  -- THE HIGH-WATER MARK for this run. ⚠ `bigint`: a long run on a large window
  -- passes 2^31 tokens, and the column that overflows is the one nobody tests.
  tokens bigint NOT NULL DEFAULT 0
    CONSTRAINT workspace_token_spend_tokens_nonneg CHECK (tokens >= 0),

  -- ── CHEAP ATTRIBUTION, AND ONLY THE CHEAP KIND ────────────────────────────
  -- ⚠ Both are COPIES of what the push already carried, so they cost no join
  -- and no second read. They are NULLABLE and no reader may require them.
  -- ⚠ `agent_name` IS PEER-INFLUENCED DISPLAY TEXT, bounded here and sanitized
  -- at the edge by the same `labelOrNull` every other operator-authored field
  -- crosses with (INVARIANTS §11). It is a LABEL, never an identity.
  agent_name text
    CONSTRAINT workspace_token_spend_agent_bounded CHECK (
      agent_name IS NULL OR length(agent_name) BETWEEN 1 AND 200
    ),
  -- ⚠ `ON DELETE SET NULL`, NEVER CASCADE: deleting a channel must not destroy
  -- the record that tokens were spent. The spend happened; the channel merely
  -- no longer exists to attribute it to. Same argument as
  -- `channel_messages.artifact_id`'s own SET NULL.
  channel_id uuid
    REFERENCES public.channels(id) ON DELETE SET NULL,

  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- ⚠ THE KEY LEADS WITH `workspace_id` so it covers that FK's cascade
  -- (INVARIANTS §12), and carries `started_at` last because that is the field
  -- that makes a RUN distinct rather than a session.
  PRIMARY KEY (workspace_id, user_id, session_key, started_at)
);

-- THE READ IS "my spend since <date>, newest first", account-wide across
-- containers — so it leads with `user_id` and NOT with the workspace, which the
-- primary key already covers.
CREATE INDEX IF NOT EXISTS workspace_token_spend_user_time_idx
  ON public.workspace_token_spend (user_id, started_at DESC);

COMMENT ON TABLE public.workspace_token_spend IS
  'Durable per-run token spend: one row per session run holding that run''s high-water mark, so Overview can show spend over time after channel_sessions has deleted the live row. Written from the desktop session push; see features/channels/server/service-token-spend.ts.';

COMMENT ON COLUMN public.workspace_token_spend.tokens IS
  'A FLOOR, never an exact figure: the reported value is quantized to 10k buckets and an ended run''s final stretch is never pushed. Always "at least this many".';

-- ── 2. RLS ──────────────────────────────────────────────────────────────────
-- 🔒 **DENY-BY-DEFAULT, SERVICE-ROLE ONLY — the discipline `channel_sessions`,
-- `channel_messages` and `channel_artifacts` already follow.** Authorization
-- lives in the service layer, which reaches the table through the RLS-bypassing
-- admin client behind `withWorkspaceAuth`. RLS is enabled WITH NO POLICIES so a
-- future PostgREST route cannot reach it by accident: no policy means no row,
-- for every role that does not bypass RLS.
--
-- ⚠ **DELIBERATELY NARROWER THAN `workspace_credit_usage`**, which grants
-- members a SELECT policy. That table is a per-WORKSPACE counter every member
-- shares. This one is per-OPERATOR: a member-scoped read policy would let any
-- workspace member read how many tokens a colleague's agents burned, which
-- nobody has ruled and which the feature does not need.
ALTER TABLE public.workspace_token_spend ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.workspace_token_spend FROM anon, authenticated;

-- ── 3. record_token_spend — the whole set in ONE statement ──────────────────
--
-- ⚠ **WHY AN RPC AND NOT A POSTGREST UPSERT.** The merge rule is
-- `GREATEST(stored, reported)`, which no upsert can express: a plain upsert
-- would let a LOWER figure overwrite a higher one, and a lower figure is
-- exactly what arrives when a report is retried out of order or a run's
-- counter restarts. The monotonic merge is the correctness property of this
-- whole feature, so it belongs in the statement rather than in a
-- read-then-write the next concurrent push can interleave with.
--
-- ⚠ **ONE STATEMENT FOR THE WHOLE PUSH**, taking the set as `jsonb` — the
-- alternative is a round trip per live session on every state change, on a path
-- whose entire design is "a handful of writes per session".
--
-- ⚠ **`WHERE EXCLUDED.tokens > t.tokens` MAKES A REPEAT REPORT FREE.** A push
-- where no session spent anything new updates zero rows and does not move
-- `updated_at`, so this cannot become a write-per-push the way an
-- unconditional upsert would.
--
-- Returns the number of rows actually INSERTED OR ADVANCED, which is what the
-- caller reports back; a push that advanced nothing honestly returns 0.
--
-- SECURITY DEFINER (the table has no client write policy at all) with a pinned
-- `search_path`, EXECUTE revoked from public/anon/authenticated per
-- 20260619040000 — called exclusively through the service-role client.
--
-- ⚠ EVERY column reference is table-qualified (`t.tokens`), the same rule
-- `consume_workspace_credits` states: an unqualified name that collides with a
-- parameter is an ambiguous-reference error under plpgsql's default
-- `variable_conflict`.
--
-- ⚠ THE IDENTITY ARGUMENTS ARE THE FENCE AND COME FROM THE AUTHENTICATED
-- CONTEXT, never from the payload — the rule `repository-sessions.ts` states in
-- capitals. Nothing in `p_marks` names a workspace or a user, so no caller can
-- write another operator's row.
CREATE OR REPLACE FUNCTION record_token_spend(
  p_workspace_id UUID,
  p_user_id      UUID,
  p_marks        JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed INT;
BEGIN
  IF p_marks IS NULL OR jsonb_typeof(p_marks) <> 'array' THEN
    RETURN 0;
  END IF;

  WITH marks AS (
    SELECT
      (m ->> 'session_key')::text        AS session_key,
      (m ->> 'started_at')::timestamptz  AS started_at,
      (m ->> 'tokens')::bigint           AS tokens,
      (m ->> 'agent_name')::text         AS agent_name,
      (m ->> 'channel_id')::uuid         AS channel_id
    FROM jsonb_array_elements(p_marks) AS m
  ),
  -- ⚠ A MARK WITH NO RUN IDENTITY OR NO MEASUREMENT IS DROPPED, NOT DEFAULTED.
  -- A null `started_at` cannot be attributed to a run, and a null `tokens` is
  -- "nothing has measured this" — the `metricOrNull` discipline the desktop
  -- keeps all the way to the wire, which a `COALESCE(…, 0)` here would spend.
  usable AS (
    SELECT * FROM marks
     WHERE session_key IS NOT NULL
       AND started_at  IS NOT NULL
       AND tokens      IS NOT NULL
       AND tokens      >= 0
  ),
  -- ⚠ DEDUPED BEFORE THE INSERT: `ON CONFLICT` cannot fire twice for one key
  -- inside a single statement (21000, "cannot affect row a second time"), and
  -- one push carrying two rows for one run is a desktop bug that must cost a
  -- dropped duplicate, never a failed write of the whole set.
  deduped AS (
    SELECT DISTINCT ON (session_key, started_at) *
      FROM usable
     ORDER BY session_key, started_at, tokens DESC
  ),
  upserted AS (
    INSERT INTO workspace_token_spend AS t (
      workspace_id, user_id, session_key, started_at,
      tokens, agent_name, channel_id, first_seen_at, updated_at
    )
    SELECT
      p_workspace_id, p_user_id, d.session_key, d.started_at,
      d.tokens, d.agent_name, d.channel_id, now(), now()
    FROM deduped d
    ON CONFLICT (workspace_id, user_id, session_key, started_at) DO UPDATE
      SET tokens     = GREATEST(t.tokens, EXCLUDED.tokens),
          -- ⚠ THE LABELS TAKE THE NEWER VALUE ONLY WHEN IT IS PRESENT: an
          -- operator renaming an agent should be reflected, but a push that
          -- omitted the name must not ERASE one already recorded.
          agent_name = COALESCE(EXCLUDED.agent_name, t.agent_name),
          channel_id = COALESCE(EXCLUDED.channel_id, t.channel_id),
          updated_at = now()
      WHERE EXCLUDED.tokens > t.tokens
    RETURNING 1
  )
  SELECT count(*)::int INTO v_changed FROM upserted;

  RETURN COALESCE(v_changed, 0);
END
$$;

REVOKE ALL ON FUNCTION record_token_spend(UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_token_spend(UUID, UUID, JSONB)
  TO service_role;

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.workspace_token_spend', 'SELECT')
     OR has_table_privilege('anon', 'public.workspace_token_spend', 'SELECT') THEN
    RAISE EXCEPTION
      'ABORT: workspace_token_spend is still SELECT-able by anon/authenticated after the revoke — something else (PUBLIC, or another granted role) holds the privilege; find it before shipping this';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.workspace_token_spend', 'SELECT') THEN
    RAISE EXCEPTION
      'ABORT: service_role cannot read workspace_token_spend — every repository select would 42501';
  END IF;
  RAISE NOTICE 'workspace_token_spend: created, service_role-only; record_token_spend() granted to service_role';
END $$;
