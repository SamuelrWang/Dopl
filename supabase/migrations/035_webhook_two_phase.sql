-- P0.4a: idempotent daily bonus
CREATE OR REPLACE FUNCTION grant_daily_bonus_atomic(
  p_user_id uuid,
  p_amount int
) RETURNS TABLE(granted boolean, new_balance int)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_balance int;
  v_last timestamptz;
BEGIN
  SELECT balance, last_daily_bonus INTO v_balance, v_last
    FROM user_credits WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 0; RETURN; END IF;

  IF v_last IS NOT NULL AND date_trunc('day', v_last AT TIME ZONE 'UTC')
                         = date_trunc('day', now()  AT TIME ZONE 'UTC') THEN
    RETURN QUERY SELECT false, v_balance; RETURN;
  END IF;

  UPDATE user_credits
    SET balance = v_balance + p_amount,
        last_daily_bonus = now(),
        updated_at = now()
    WHERE user_id = p_user_id;
  INSERT INTO credit_ledger (user_id, amount, action, metadata)
    VALUES (p_user_id, p_amount, 'daily_bonus', '{}'::jsonb);
  RETURN QUERY SELECT true, v_balance + p_amount;
END;
$$;

-- P0.4b: atomic cycle reset
CREATE OR REPLACE FUNCTION reset_cycle_atomic(
  p_user_id uuid,
  p_tier text,
  p_monthly int,
  p_rollover boolean
) RETURNS TABLE(new_balance int)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_balance int;
  v_new int;
BEGIN
  SELECT balance INTO v_balance
    FROM user_credits WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 0; RETURN; END IF;

  IF p_rollover THEN
    v_new := least(v_balance, p_monthly) + p_monthly;
  ELSE
    v_new := p_monthly;
  END IF;

  UPDATE user_credits
    SET balance = v_new,
        cycle_start = now(),
        cycle_credits_granted = p_monthly,
        updated_at = now()
    WHERE user_id = p_user_id;
  INSERT INTO credit_ledger (user_id, amount, action, metadata)
    VALUES (p_user_id, p_monthly, 'monthly_grant',
            jsonb_build_object('tier', p_tier));
  RETURN QUERY SELECT v_new;
END;
$$;

-- P0.4c: atomic upgrade grant
CREATE OR REPLACE FUNCTION handle_upgrade_atomic(
  p_user_id uuid,
  p_new_tier text,
  p_new_monthly int
) RETURNS TABLE(new_balance int, granted int)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_balance int;
  v_already int;
  v_diff int;
BEGIN
  SELECT balance, cycle_credits_granted INTO v_balance, v_already
    FROM user_credits WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 0, 0; RETURN; END IF;

  v_diff := p_new_monthly - coalesce(v_already, 0);
  IF v_diff <= 0 THEN
    UPDATE user_credits
      SET cycle_credits_granted = p_new_monthly, updated_at = now()
      WHERE user_id = p_user_id;
    RETURN QUERY SELECT v_balance, 0; RETURN;
  END IF;

  UPDATE user_credits
    SET balance = v_balance + v_diff,
        cycle_credits_granted = p_new_monthly,
        updated_at = now()
    WHERE user_id = p_user_id;
  INSERT INTO credit_ledger (user_id, amount, action, metadata)
    VALUES (p_user_id, v_diff, 'upgrade_grant',
            jsonb_build_object('tier', p_new_tier));
  RETURN QUERY SELECT v_balance + v_diff, v_diff;
END;
$$;

-- P1.3: idempotent first-time initialization with ledger entry
CREATE OR REPLACE FUNCTION init_credits_atomic(
  p_user_id uuid,
  p_amount int
) RETURNS TABLE(balance int, inserted boolean)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_inserted boolean;
  v_balance int;
BEGIN
  INSERT INTO user_credits (user_id, balance, cycle_start, cycle_credits_granted)
    VALUES (p_user_id, p_amount, now(), p_amount)
    ON CONFLICT (user_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_inserted := v_inserted > 0;

  IF v_inserted THEN
    INSERT INTO credit_ledger (user_id, amount, action, metadata)
      VALUES (p_user_id, p_amount, 'initial_grant', '{}'::jsonb);
  END IF;

  SELECT user_credits.balance INTO v_balance
    FROM user_credits WHERE user_id = p_user_id;
  RETURN QUERY SELECT v_balance, v_inserted;
END;
$$;