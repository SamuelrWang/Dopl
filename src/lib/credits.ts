import { supabaseAdmin } from "@/lib/supabase";

// ── Credit costs per action ──────────────────────────────────────────

export const CREDIT_COSTS = {
  // MCP / data access
  mcp_search: 1,
  mcp_get_entry: 1,
  mcp_list: 1,
  mcp_cluster_query: 1,
  mcp_cluster_read: 1,
  // AI-heavy operations
  mcp_build: 5,
  mcp_synthesize: 10,
  // Chat (in-app)
  chat_message: 2,
  chat_tool_call: 3,
  // Ingestion
  ingestion: 7,
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;

// ── Tier definitions ─────────────────────────────────────────────────

export type SubscriptionTier = "free" | "pro" | "power";

export const TIER_CREDITS: Record<
  SubscriptionTier,
  { monthly: number; dailyBonus: number; rollover: boolean }
> = {
  free: { monthly: 100, dailyBonus: 5, rollover: false },
  pro: { monthly: 500, dailyBonus: 5, rollover: true },
  power: { monthly: 2000, dailyBonus: 10, rollover: true },
};

const CYCLE_DAYS = 30;

// ── Read balance ─────────────────────────────────────────────────────

export interface CreditBalance {
  balance: number;
  cycleStart: string;
  cycleEnd: string;
  cycleCreditsGranted: number;
  lastDailyBonus: string | null;
}

export async function getBalance(userId: string): Promise<CreditBalance> {
  const supabase = supabaseAdmin();
  const { data } = await supabase
    .from("user_credits")
    .select("balance, cycle_start, cycle_credits_granted, last_daily_bonus")
    .eq("user_id", userId)
    .single();

  if (!data) {
    // First time — initialize via atomic RPC so two concurrent first-time
    // requests can't both insert, and so the initial 100-credit grant lands
    // in credit_ledger for audit trail. RPC is a no-op if the row already
    // exists (INSERT ... ON CONFLICT DO NOTHING).
    const initAmount = TIER_CREDITS.free.monthly;
    const { error } = await supabase.rpc("init_credits_atomic", {
      p_user_id: userId,
      p_amount: initAmount,
    });
    if (error) {
      // Non-fatal — the row might already exist from a concurrent init.
      // Fall through to reread.
    }
    // Reread after init to pick up the now-guaranteed row.
    const { data: fresh } = await supabase
      .from("user_credits")
      .select("balance, cycle_start, cycle_credits_granted, last_daily_bonus")
      .eq("user_id", userId)
      .single();
    if (fresh) {
      return {
        balance: fresh.balance,
        cycleStart: fresh.cycle_start,
        cycleEnd: addDays(fresh.cycle_start, CYCLE_DAYS),
        cycleCreditsGranted: fresh.cycle_credits_granted,
        lastDailyBonus: fresh.last_daily_bonus,
      };
    }
    // Fallback shape — RPC failed and reread returned nothing. Return
    // synthetic defaults so callers don't crash; the next request will
    // retry init.
    const cycleStart = new Date().toISOString();
    return {
      balance: initAmount,
      cycleStart,
      cycleEnd: addDays(cycleStart, CYCLE_DAYS),
      cycleCreditsGranted: initAmount,
      lastDailyBonus: null,
    };
  }

  return {
    balance: data.balance,
    cycleStart: data.cycle_start,
    cycleEnd: addDays(data.cycle_start, CYCLE_DAYS),
    cycleCreditsGranted: data.cycle_credits_granted,
    lastDailyBonus: data.last_daily_bonus,
  };
}

// ── Deduct credits ───────────────────────────────────────────────────

export async function deductCredits(
  userId: string,
  action: CreditAction | string,
  metadata?: Record<string, unknown>
): Promise<{ success: boolean; newBalance: number }> {
  const cost = CREDIT_COSTS[action as CreditAction] ?? 1;
  const supabase = supabaseAdmin();

  // Single atomic RPC: SELECT FOR UPDATE, balance check, UPDATE, ledger insert.
  // Prevents the race where two concurrent requests both pass a non-atomic check.
  const { data, error } = await supabase.rpc("deduct_credits_atomic", {
    p_user_id: userId,
    p_amount: cost,
    p_action: action,
    p_metadata: metadata ?? {},
  });

  if (error) {
    // Fail closed on DB errors — don't silently grant a free action.
    return { success: false, newBalance: 0 };
  }

  // RPC returns a set (RETURN QUERY), so data is an array of one row.
  const row = Array.isArray(data) ? data[0] : data;
  return {
    success: !!row?.success,
    newBalance: row?.new_balance ?? 0,
  };
}

// ── Grant credits ────────────────────────────────────────────────────

export async function grantCredits(
  userId: string,
  amount: number,
  action: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const supabase = supabaseAdmin();

  // Atomic RPC: SELECT FOR UPDATE → increment → ledger insert, all in one
  // transaction. Mirrors deduct_credits_atomic so two concurrent refunds
  // can't read the same balance and overwrite each other.
  const { data, error } = await supabase.rpc("grant_credits_atomic", {
    p_user_id: userId,
    p_amount: amount,
    p_action: action,
    p_metadata: metadata ?? {},
  });

  if (error) {
    throw new Error(`grant_credits_atomic failed: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.success) {
    throw new Error("grant_credits_atomic returned success=false");
  }
}

// ── Daily bonus ──────────────────────────────────────────────────────

export async function grantDailyBonus(
  userId: string,
  tier: SubscriptionTier = "free"
): Promise<boolean> {
  const supabase = supabaseAdmin();

  // Atomic RPC: SELECT FOR UPDATE → date-of-last-bonus idempotency check →
  // balance bump + ledger insert, all in one transaction. Prevents the
  // double-grant race where two concurrent requests both read yesterday's
  // timestamp, both pass the check, and both credit the bonus.
  const { data, error } = await supabase.rpc("grant_daily_bonus_atomic", {
    p_user_id: userId,
    p_amount: TIER_CREDITS[tier].dailyBonus,
  });

  if (error) return false;

  const row = Array.isArray(data) ? data[0] : data;
  return !!row?.granted;
}

// ── Cycle reset (monthly grant) ──────────────────────────────────────

export async function grantCycleCredits(
  userId: string,
  tier: SubscriptionTier
): Promise<void> {
  const supabase = supabaseAdmin();
  const tierConfig = TIER_CREDITS[tier];

  // Atomic RPC: SELECT FOR UPDATE → compute rollover → UPDATE + ledger,
  // all in one transaction. Prevents two concurrent cycle-rollover
  // triggers from both overwriting each other's computed rollover.
  const { error } = await supabase.rpc("reset_cycle_atomic", {
    p_user_id: userId,
    p_tier: tier,
    p_monthly: tierConfig.monthly,
    p_rollover: tierConfig.rollover,
  });

  if (error) {
    throw new Error(`reset_cycle_atomic failed: ${error.message}`);
  }
}

// ── Handle upgrade (pro-rate) ────────────────────────────────────────

export async function handleUpgrade(
  userId: string,
  oldTier: SubscriptionTier,
  newTier: SubscriptionTier
): Promise<void> {
  const supabase = supabaseAdmin();

  // Atomic RPC: SELECT FOR UPDATE → diff calc → UPDATE + ledger, all in
  // one transaction. RPC reads cycle_credits_granted as the already-granted
  // anchor (same semantics as the prior TS code), so oldTier is informational
  // only — kept for caller symmetry and metadata.
  const { error } = await supabase.rpc("handle_upgrade_atomic", {
    p_user_id: userId,
    p_new_tier: newTier,
    p_new_monthly: TIER_CREDITS[newTier].monthly,
  });

  if (error) {
    throw new Error(`handle_upgrade_atomic failed: ${error.message}`);
  }

  // oldTier is kept in the function signature so existing webhook call
  // sites don't need to change; the RPC doesn't need it because
  // cycle_credits_granted already encodes the "what the user was on" state.
  void oldTier;
}

// ── Check if cycle needs reset ───────────────────────────────────────

export async function checkAndResetCycle(
  userId: string,
  tier: SubscriptionTier,
  subscriptionPeriodEnd?: string | null
): Promise<void> {
  const supabase = supabaseAdmin();

  const { data } = await supabase
    .from("user_credits")
    .select("cycle_start")
    .eq("user_id", userId)
    .single();

  if (!data) return;

  const cycleStart = new Date(data.cycle_start);
  const now = new Date();

  // For paid users with a Stripe period end, use that as the cycle boundary
  if (subscriptionPeriodEnd && tier !== "free") {
    const periodEnd = new Date(subscriptionPeriodEnd);
    if (now >= periodEnd) {
      await grantCycleCredits(userId, tier);
      return;
    }
  }

  // For free users or fallback: rolling 30-day cycle
  const daysSinceCycleStart =
    (now.getTime() - cycleStart.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceCycleStart >= CYCLE_DAYS) {
    await grantCycleCredits(userId, tier);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
