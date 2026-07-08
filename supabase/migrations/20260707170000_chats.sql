-- Chat archive — agent-exported conversations (MCP-first).
--
-- The user's agent exports finished sessions into Dopl via dopl_chats;
-- the /chats page is the read surface. Chats are private to their owner
-- by default; the owner can share one with the workspace (visibility =
-- 'public', reversible). Folders are personal organization. Messages
-- are per-row summaries (verbatim only when the user asked for it).
--
-- Writes go through the service layer (service role). RLS carries the
-- read model: owner always, workspace members when public.

CREATE TABLE chat_folders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id, name)
);

CREATE TABLE chats (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id          UUID REFERENCES chat_folders(id) ON DELETE SET NULL,
  -- Agent-supplied idempotency key: re-exporting the same session
  -- updates the existing chat instead of duplicating it.
  client_session_id  TEXT,
  title              TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  overview           TEXT NOT NULL DEFAULT '',
  source             TEXT NOT NULL DEFAULT 'other'
                       CHECK (source IN ('claude-code', 'claude-desktop', 'cursor', 'other')),
  project            TEXT,
  format             TEXT NOT NULL DEFAULT 'summarized'
                       CHECK (format IN ('summarized', 'verbatim', 'mixed')),
  session_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  visibility         TEXT NOT NULL DEFAULT 'private'
                       CHECK (visibility IN ('private', 'public')),
  pinned             BOOLEAN NOT NULL DEFAULT false,
  deliverables       JSONB NOT NULL DEFAULT '[]'::jsonb,
  learnings          JSONB NOT NULL DEFAULT '[]'::jsonb,
  exported_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX chats_client_session_key
  ON chats (workspace_id, owner_id, client_session_id)
  WHERE client_session_id IS NOT NULL;

CREATE INDEX chats_workspace_public_idx
  ON chats (workspace_id, updated_at DESC)
  WHERE visibility = 'public';

CREATE INDEX chats_owner_idx
  ON chats (workspace_id, owner_id, updated_at DESC);

CREATE INDEX chats_folder_idx ON chats (folder_id);

CREATE TABLE chat_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id       UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL CHECK (position >= 1),
  role          TEXT NOT NULL CHECK (role IN ('user', 'agent')),
  summary       TEXT NOT NULL,
  verbatim      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chat_id, position)
);

CREATE INDEX chat_messages_workspace_idx ON chat_messages (workspace_id);

ALTER TABLE chat_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_folders_owner_select ON chat_folders
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY chats_owner_select ON chats
  FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY chats_member_select_public ON chats
  FOR SELECT
  USING (
    visibility = 'public'
    AND is_workspace_member(workspace_id, auth.uid(), 'viewer')
  );

CREATE POLICY chat_messages_select ON chat_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id = chat_id
        AND (
          c.owner_id = auth.uid()
          OR (
            c.visibility = 'public'
            AND is_workspace_member(c.workspace_id, auth.uid(), 'viewer')
          )
        )
    )
  );
