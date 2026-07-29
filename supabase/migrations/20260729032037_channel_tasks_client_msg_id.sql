-- Channels — create_task idempotency.
-- A retried create_task (same op re-sent after a transient failure) could
-- otherwise double-create a task row AND double-spawn the responder's session
-- window. Mirror channel_messages' idempotency: a nullable per-task client key
-- + a partial unique index, so a re-sent (channel_id, client_msg_id) collides
-- instead of inserting a second row and the service converges on the winner.
ALTER TABLE public.channel_tasks ADD COLUMN IF NOT EXISTS client_msg_id TEXT;

-- Partial so unlabeled tasks (created with no client key) aren't constrained.
CREATE UNIQUE INDEX IF NOT EXISTS channel_tasks_client_msg_key
  ON public.channel_tasks (channel_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;
