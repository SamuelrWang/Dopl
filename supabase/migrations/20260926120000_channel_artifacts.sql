-- ============================================================================
-- ARTIFACTS — A THREAD FORMED AFTER THE FACT (design at Mobile Command Center
-- #1220, accepted WHOLESALE by Samuel at #1222; KB "Artifacts design v1").
-- ============================================================================
--
-- ⚠ **WHAT AN ARTIFACT IS.** A name + summary card that FOLDS a set of existing
-- main-room messages into one entry on the default read. It is not an edit and
-- not a delete: every message keeps its body, its author, its metadata and its
-- `seq`. Folding is a VIEW decision recorded on the row, and it is reversible
-- without loss. That property is what makes the rest of the design cheap, so it
-- is the one to protect if anything here is ever traded away.
--
-- 🔒 **MEMBERSHIP IS A NULLABLE COLUMN ON `channel_messages`, NOT A LIST ON THE
-- ARTIFACT** (design §2), and three of the five ruled decisions fall out of that
-- choice rather than being enforced by anything:
--
--   * **One artifact per message, no overlaps** (decision 4) is what a single
--     column MEANS. Nothing has to check it and nothing can drift from it.
--   * **No nesting, for free** — `channel_artifacts` has no `artifact_id`, so
--     there is nowhere for one to go. ⚠ If nesting is ever wanted it is a
--     DIFFERENT schema, not an extension of this one (design §7, fork 4).
--   * **The `seq` is untouched**, because the row never moves. Citation
--     resolution is unchanged: same table, same seq, same RLS.
--
-- ⚠ **IT MUST NOT BE A NEW `channel_messages.kind`** and the design says why:
-- `kind` carries a CHECK constraint, and this codebase already ruled this exact
-- question once — `session-effects.js` uses `extra: { session_ended: true }`
-- rather than a new kind. A new kind is a value every existing reader must
-- learn; a column the old readers ignore is purely additive.
--
-- ⚠ **THE HONEST BREAKING PART, STATED RATHER THAN HIDDEN** (design §4): an
-- artifact-unaware client gets a CARD where it expected messages. There is no
-- version of "saves context" that is also invisible to existing readers — the
-- saving IS the substitution. The pin that keeps it survivable is enforced in
-- the service, not here: a read that NAMES a message (an explicit seq, or a
-- range naming it) returns the MESSAGE, never the card. See
-- `server/service-artifacts.ts › foldMessages`.
--
-- ROLLBACK: `ALTER TABLE public.channel_messages DROP COLUMN artifact_id;`
-- then `DROP TABLE public.channel_artifacts;`. ⚠ Dropping the COLUMN alone is
-- the safe half and is enough to un-fold every transcript — no message row is
-- altered by this feature, so a rollback loses only the grouping.
-- ============================================================================

-- ── 1. The artifact ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.channel_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL
    REFERENCES public.channels(id) ON DELETE CASCADE,
  -- ⚠ DENORMALIZED FROM THE CHANNEL, like `channel_tasks.workspace_id`: every
  -- tenancy filter in this feature reads the container without a join.
  workspace_id uuid NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- ⚠ NAME AND SUMMARY ARE PEER-INFLUENCED STRINGS THAT RENDER INTO
  -- `dopl_channel` RESULTS, so they take the bounds class this tree already
  -- sets on `channels.name` and `channel_tasks.title` rather than inventing a
  -- third rule: trimmed, length-bounded, and no control / zero-width / bidi
  -- characters. The charset half is `shared/lib/safe-label.ts › SAFE_LABEL_RE`
  -- at the edge; the CHECKs below are the half the database can state.
  -- ⚠ `btrim` IS LOAD-BEARING: `safeLabel()` trims before validating, so an
  -- untrimmed value reaching here means a writer bypassed the schema.
  name text NOT NULL
    CONSTRAINT channel_artifacts_name_trimmed CHECK (name = btrim(name))
    CONSTRAINT channel_artifacts_name_bounded  CHECK (length(name) BETWEEN 1 AND 200),
  -- ⚠ SUMMARY IS PROSE (newlines legal, `SAFE_PROSE_RE`) and OPTIONAL-as-empty,
  -- so it is bounded but not `min 1`.
  summary text NOT NULL DEFAULT ''
    CONSTRAINT channel_artifacts_summary_bounded CHECK (length(summary) <= 2000),

  -- WHO MADE IT. ⚠ Both halves, because the design's authority rule (decision 1)
  -- names both: un-boxing is free for the artifact's CREATOR as well as for the
  -- folded message's author, and "an agent boxed its own work" is only
  -- attributable if the instance id is kept beside the person.
  created_by uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  -- ⚠ NULLABLE AND NOT A FOREIGN KEY — the agent INSTANCE id, the same free
  -- string `channel_messages.metadata.author_agent_id` carries. A person acting
  -- directly leaves it null.
  created_by_agent text
    CONSTRAINT channel_artifacts_agent_bounded CHECK (
      created_by_agent IS NULL OR length(created_by_agent) BETWEEN 1 AND 200
    ),

  -- ⚠ RETIRED, NEVER DELETED (design §5, `action="dissolve"`). Dissolve clears
  -- `artifact_id` from every member and stamps this; the row survives so an old
  -- id still resolves to something honest instead of 404-ing a citation.
  dissolved_at timestamptz,

  -- ⚠ IDEMPOTENCY, AND THE DESIGN ASKS FOR IT BY NAME (§5): "an agent retrying a
  -- create with no key makes a second artifact over messages the first one
  -- already took, and then half the run is in each."
  client_msg_id text
    CONSTRAINT channel_artifacts_client_msg_id_bounded CHECK (
      client_msg_id IS NULL OR length(client_msg_id) BETWEEN 1 AND 200
    ),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 🔒 **AUTHOR-SCOPED IDEMPOTENCY, (channel, client_msg_id, created_by)** — the
-- same key shape, in the same column order, as
-- `20260913120000_channel_tasks_author_scoped_idempotency.sql` and
-- `20260822120000_channel_messages_author_scoped_idempotency.sql`, and for the
-- SAME vulnerability: channel-scoped, idempotency is a contract with the whole
-- ROOM, so any member could pre-claim a key another member's agent was about to
-- use and be handed that agent's row. The keys are derived and guessable.
-- ⚠ PARTIAL, so the many rows with no key do not collide with each other.
-- ⚠ THE REPOSITORY PROBE MUST AGREE WITH THIS INDEX
-- (`repository-artifacts.ts › findOwnArtifactByClientId`). Scoping only the READ
-- turns the silent convergence into a 23505 the caller sees as a 500.
CREATE UNIQUE INDEX IF NOT EXISTS channel_artifacts_client_msg_author_key
  ON public.channel_artifacts (channel_id, client_msg_id, created_by)
  WHERE client_msg_id IS NOT NULL;

-- The listing read is "this channel's live artifacts, newest first".
CREATE INDEX IF NOT EXISTS channel_artifacts_channel_idx
  ON public.channel_artifacts (channel_id, created_at DESC);

COMMENT ON TABLE public.channel_artifacts IS
  'A thread formed after the fact: a name+summary card folding a set of existing channel_messages via their artifact_id column. Non-destructive and reversible; dissolve clears the column and stamps dissolved_at. See features/channels/server/service-artifacts.ts.';

-- ── 2. Membership — the whole of it ─────────────────────────────────────────
-- ⚠ ADDITIVE BY CONSTRUCTION. Every existing reader does `select("*")` and will
-- now receive one extra nullable column it does not mention; nothing breaks,
-- and a reader that has not learned about artifacts simply never folds.
ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS artifact_id uuid
    REFERENCES public.channel_artifacts(id) ON DELETE SET NULL;

-- ⚠ `ON DELETE SET NULL`, NOT CASCADE, AND THE DIFFERENCE IS THE WHOLE SAFETY
-- ARGUMENT. `CASCADE` here would mean "deleting an artifact deletes the
-- messages it folded" — a view decision silently destroying a room's history,
-- which is precisely what "an artifact is not a delete" forbids. Nothing in the
-- app deletes an artifact row (dissolve retires it), so this is the belt behind
-- that rule rather than a path anybody takes.

COMMENT ON COLUMN public.channel_messages.artifact_id IS
  'Nullable membership in a channel_artifacts row. A single column IS the "one artifact per message, no nesting" rule (design #1220 §2). NULL = renders normally.';

-- ⚠ THE FOLD READ IS "which of the messages on this page are folded, and into
-- what", so the page's own (channel_id, seq) index already orders it; this
-- partial index serves the OPPOSITE direction — "give me the members of THIS
-- artifact, in seq order" (`op=read, artifact=<id>`) — and is partial because
-- the overwhelming majority of rows are NULL and must not be indexed.
CREATE INDEX IF NOT EXISTS channel_messages_artifact_idx
  ON public.channel_messages (artifact_id, seq)
  WHERE artifact_id IS NOT NULL;

-- ── 3. RLS ──────────────────────────────────────────────────────────────────
-- 🔒 **DENY-BY-DEFAULT, SERVICE-ROLE ONLY — the discipline `channel_messages`
-- and `channel_tasks` already follow.** Visibility and authz for this feature
-- live in the SERVICE layer (`service-artifacts.ts`), reached through the
-- RLS-bypassing admin client, exactly as `repository-tasks.ts` documents for
-- `channel_tasks`. RLS is enabled WITH NO POLICIES so that a future PostgREST
-- route cannot reach the table by accident: no policy means no row, for every
-- role that does not bypass RLS.
--
-- ⚠ **THIS IS NOT "AUTHZ TODO".** The design (§8) deliberately did NOT invent
-- server-side authorization beyond "messages you can already read", because the
-- personal-resources work (task 11) was landing rules in that area and a second
-- answer written here would be the second-authority shape this tree keeps
-- filing bugs about. The artifact gate is therefore the CHANNEL's own read
-- gate — `service-shared.ts › loadVisibleChannel` — and nothing else.
ALTER TABLE public.channel_artifacts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.channel_artifacts FROM anon, authenticated;

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.channel_artifacts', 'SELECT')
     OR has_table_privilege('anon', 'public.channel_artifacts', 'SELECT') THEN
    RAISE EXCEPTION
      'ABORT: channel_artifacts is still SELECT-able by anon/authenticated after the revoke — something else (PUBLIC, or another granted role) holds the privilege; find it before shipping this';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.channel_artifacts', 'SELECT') THEN
    RAISE EXCEPTION
      'ABORT: service_role cannot read channel_artifacts — every repository select would 42501';
  END IF;
  RAISE NOTICE 'channel_artifacts: created, service_role-only; channel_messages.artifact_id added (nullable, ON DELETE SET NULL)';
END $$;
