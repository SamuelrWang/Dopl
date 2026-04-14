-- Migration: chat_attachments table + storage bucket for multimodal chat support

-- ── Table ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  panel_id     TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  file_size    INTEGER NOT NULL,
  mime_type    TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chat_attachments_user ON chat_attachments(user_id);
CREATE INDEX idx_chat_attachments_panel ON chat_attachments(user_id, panel_id);

ALTER TABLE chat_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_attachments_select_own ON chat_attachments
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY chat_attachments_insert_own ON chat_attachments
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY chat_attachments_delete_own ON chat_attachments
  FOR DELETE USING (user_id = auth.uid());

-- ── Storage bucket ─────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments',
  'chat-attachments',
  false,
  10485760,  -- 10MB
  ARRAY[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf',
    'text/plain', 'text/markdown', 'text/csv',
    'application/json'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: users can only access their own folder ({uid}/...)
CREATE POLICY chat_attachments_storage_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY chat_attachments_storage_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY chat_attachments_storage_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
