-- Stripe event-ordering watermark for workspace_billing.
--
-- Stripe delivers webhooks at-least-once and WITHOUT ordering guarantees:
-- a redelivered or out-of-order `customer.subscription.updated` (status
-- active) can arrive AFTER `customer.subscription.deleted` and resurrect a
-- canceled workspace back to Pro forever. `last_stripe_event_created` is a
-- freshness watermark — the Stripe `event.created` timestamp (epoch
-- SECONDS) of the most recently APPLIED billing event. The webhook handler
-- skips any subscription/payment event whose `event.created` is <= this
-- value and stamps it with every applied event, so stale replays no-op.
--
-- Nullable + no default: existing rows start unstamped (NULL), which the
-- handler treats as "no watermark yet — apply and stamp".

ALTER TABLE workspace_billing
  ADD COLUMN IF NOT EXISTS last_stripe_event_created BIGINT;
