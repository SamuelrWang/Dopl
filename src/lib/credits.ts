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
  chat_message: 3,
  chat_tool_call: 5,
  // Ingestion
  ingestion: 20,
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
    // First time — initialize
    await supabase.from("user_credits").upsert({
      user_id: userId,
      balance: 100,
      cycle_start: new Date().toISOString(),
      cycle_credits_granted: 100,
    });
    const cycleStart = new Date().toISOString();
    return {
      balance: 100,
      cycleStart,
      cycleEnd: addDays(cycleStart, CYCLE_DAYS),
      cycleCreditsGranted: 100,
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

  // Increment balance
  const { data: current } = await supabase
    .from("user_credits")
    .select("balance")
    .eq("user_id", userId)
    .single();

  const newBalance = (current?.balance ?? 0) + amount;

  await supabase.from("user_credits").upsert({
    user_id: userId,
    balance: newBalance,
    updated_at: new Date().toISOString(),
  });

  await supabase.from("credit_ledger").insert({
    user_id: userId,
    amount,
    action,
    metadata: metadata ?? {},
  });
}

// ── Daily bonus ──────────────────────────────────────────────────────

export async function grantDailyBonus(
  userId: string,
  tier: SubscriptionTier = "free"
): Promise<boolean> {
  const supabase = supabaseAdmin();

  const { data } = await supabase
    .from("user_credits")
    .select("last_daily_bonus, balance")
    .eq("user_id", userId)
    .single();

  if (!data) return false;

  // Check if bonus already granted today
  if (data.last_daily_bonus) {
    const lastBonus = new Date(data.last_daily_bonus);
    const now = new Date();
    if (
      lastBonus.getUTCFullYear() === now.getUTCFullYear() &&
      lastBonus.getUTCMonth() === now.getUTCMonth() &&
      lastBonus.getUTCDate() === now.getUTCDate()
    ) {
      return false; // Already granted today
    }
  }

  const bonus = TIER_CREDITS[tier].dailyBonus;
  const newBalance = data.balance + bonus;

  await supabase
    .from("user_credits")
    .update({
      balance: newBalance,
      last_daily_bonus: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  await supabase.from("credit_ledger").insert({
    user_id: userId,
    amount: bonus,
    action: "daily_bonus",
  });

  return true;
}

// ── Cycle reset (monthly grant) ──────────────────────────────────────

export async function grantCycleCredits(
  userId: string,
  tier: SubscriptionTier
): Promise<void> {
  const supabase = supabaseAdmin();
  const tierConfig = TIER_CREDITS[tier];

  const { data: current } = await supabase
    .from("user_credits")
    .select("balance")
    .eq("user_id", userId)
    .single();

  // Rollover: paid users keep up to 1 cycle's worth
  let newBalance = tierConfig.monthly;
  if (tierConfig.rollover && current) {
    const carryOver = Math.min(current.balance, tierConfig.monthly);
    newBalance = carryOver + tierConfig.monthly;
  }

  await supabase
    .from("user_credits")
    .upsert({
      user_id: userId,
      balance: newBalance,
      cycle_start: new Date().toISOString(),
      cycle_credits_granted: tierConfig.monthly,
      updated_at: new Date().toISOString(),
    });

  await supabase.from("credit_ledger").insert({
    user_id: userId,
    amount: tierConfig.monthly,
    action: "monthly_grant",
    metadata: { tier },
  });
}

// ── Handle upgrade (pro-rate) ────────────────────────────────────────

export async function handleUpgrade(
  userId: string,
  oldTier: SubscriptionTier,
  newTier: SubscriptionTier
): Promise<void> {
  const supabase = supabaseAdmin();

  const { data } = await supabase
    .from("user_credits")
    .select("balance, cycle_credits_granted")
    .eq("user_id", userId)
    .single();

  const alreadyGranted = data?.cycle_credits_granted ?? TIER_CREDITS[oldTier].monthly;
  const newTierMonthly = TIER_CREDITS[newTier].monthly;
  const difference = newTierMonthly - alreadyGranted;

  if (difference <= 0) return; // Downgrade or same — no additional grant

  const newBalance = (data?.balance ?? 0) + difference;

  await supabase
    .from("user_credits")
    .update({
      balance: newBalance,
      cycle_credits_granted: newTierMonthly,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  await supabase.from("credit_ledger").insert({
    user_id: userId,
    amount: difference,
    action: "upgrade_grant",
    metadata: { oldTier, newTier, proRated: true },
  });
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
