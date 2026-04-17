/**
 * One-off: upgrade Samuel Wang's two accounts to Pro (active).
 *
 * Usage:
 *   npx tsx scripts/upgrade-samuel-to-pro.ts          # dry run — lists matches
 *   npx tsx scripts/upgrade-samuel-to-pro.ts --commit # apply the upgrade
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const commit = process.argv.includes("--commit");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

async function main() {
  // Pull anything that looks like a Samuel Wang account. Match on email,
  // display_name, or github_username — whichever columns happen to have it.
  const { data, error } = await admin
    .from("profiles")
    .select(
      "id, email, display_name, github_username, subscription_tier, subscription_status, subscription_period_end, stripe_customer_id, stripe_subscription_id"
    )
    .or(
      "email.ilike.%samuel%,display_name.ilike.%samuel%,display_name.ilike.%wang%,github_username.ilike.%samuel%"
    );

  if (error) {
    console.error("Lookup failed:", error.message);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log("No matching profiles found.");
    return;
  }

  console.log(`Found ${data.length} matching profile(s):\n`);
  for (const row of data) {
    console.log("---");
    console.log("id:                  ", row.id);
    console.log("email:               ", row.email);
    console.log("display_name:        ", row.display_name);
    console.log("github_username:     ", row.github_username);
    console.log("subscription_tier:   ", row.subscription_tier);
    console.log("subscription_status: ", row.subscription_status);
    console.log("period_end:          ", row.subscription_period_end);
    console.log("stripe_customer_id:  ", row.stripe_customer_id);
    console.log("stripe_subscription: ", row.stripe_subscription_id);
  }
  console.log("---\n");

  if (!commit) {
    console.log("Dry run. Re-run with --commit to upgrade these accounts to Pro.");
    return;
  }

  // Upgrade: set tier=pro, status=active. Leave Stripe IDs alone — this is
  // a manual comp, not a Stripe-driven subscription. Give them a 1-year
  // period_end so access doesn't expire on them.
  const oneYearOut = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  for (const row of data) {
    const { error: updateError } = await admin
      .from("profiles")
      .update({
        subscription_tier: "pro",
        subscription_status: "active",
        subscription_period_end: oneYearOut,
      })
      .eq("id", row.id);

    if (updateError) {
      console.error(`  ❌ ${row.id} (${row.email}): ${updateError.message}`);
    } else {
      console.log(`  ✅ ${row.id} (${row.email}) → pro / active, period_end=${oneYearOut}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
