-- Early Supporter Grant: first 100 users to sign in get 500 bonus credits
-- (the Pro monthly amount) added to their Free-tier balance. Plan tier is
-- NOT changed — only user_credits.balance is bumped. One-time, claim-based,
-- no expiration.

-- 1. Track who has received the grant and when.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS early_supporter_granted_at TIMESTAMPTZ NULL;

-- Speed up the count(*) check inside the RPC.
CREATE INDEX IF NOT EXISTS profiles_early_supporter_granted_at_idx
  ON profiles (early_supporter_granted_at)
  WHERE early_supporter_granted_at IS NOT NULL;

-- 2. Atomic claim function. Single transaction:
--    a) lock the caller's profile row
--    b) bail out if they've already claimed
--    c) bail out if all 100 slots are filled
--    d) otherwise stamp granted_at + call grant_credits_atomic(500)
--
-- Returns jsonb so the TS wrapper can branch cleanly:
--   {granted: true, amount: 500, slot_number: N}
--   {granted: false, reason: "already_claimed"}
--   {granted: false, reason: "promo_full"}
--   {granted: false, reason: "no_profile"}
CREATE OR REPLACE FUNCTION claim_early_supporter_grant(p_user_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_already TIMESTAMPTZ;
  v_count   INT;
  v_grant_amount CONSTANT INT := 500;
  v_grant_result jsonb;
BEGIN
  -- (a) Lock this profile to prevent duplicate concurrent claims for the
  -- same user. If no row exists yet (profile trigger hasn't run), bail.
  SELECT early_supporter_granted_at
    INTO v_already
    FROM profiles
   WHERE id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'no_profile');
  END IF;

  -- (b) Idempotency.
  IF v_already IS NOT NULL THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'already_claimed');
  END IF;

  -- (c) Promo cap. Counted inside the same tx so concurrent claimers see
  -- a consistent count under SERIALIZABLE/READ COMMITTED — combined with
  -- the row-level lock above, this prevents over-granting.
  SELECT COUNT(*) INTO v_count
    FROM profiles
   WHERE early_supporter_granted_at IS NOT NULL;

  IF v_count >= 100 THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'promo_full');
  END IF;

  -- (d) Stamp first so concurrent counters see the slot taken.
  UPDATE profiles
     SET early_supporter_granted_at = now()
   WHERE id = p_user_id;

  -- Hand off to the existing atomic grant function — same code path used
  -- by every other credit grant in the app.
  SELECT grant_credits_atomic(
    p_user_id,
    v_grant_amount,
    'early_user_grant',
    jsonb_build_object('slot_number', v_count + 1)
  ) INTO v_grant_result;

  RETURN jsonb_build_object(
    'granted', true,
    'amount', v_grant_amount,
    'slot_number', v_count + 1
  );
END;
$$;

-- Service role calls this from the auth callback. RLS doesn't apply because
-- of SECURITY DEFINER, but we still restrict EXECUTE to be safe.
REVOKE ALL ON FUNCTION claim_early_supporter_grant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_early_supporter_grant(UUID) TO service_role;
