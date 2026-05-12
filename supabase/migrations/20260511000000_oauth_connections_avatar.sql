-- Store the connected account's real avatar URL fetched from the
-- provider's profile API (Slack image_192, GitHub avatar_url, Google
-- photoLink, Notion avatar_url, etc.). Captured at OAuth-callback time
-- by finalizeConnectionRow() in src/features/integrations/server/service.ts
-- and surfaced by /api/integrations/connections so the settings UI can
-- render the user's actual provider profile picture instead of the
-- Gravatar fallback derived from email.

ALTER TABLE oauth_connections
  ADD COLUMN account_avatar_url TEXT;
