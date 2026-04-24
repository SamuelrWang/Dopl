/**
 * One-shot: run syncPack("rokid") locally so we can confirm the
 * GITHUB_TOKEN + Supabase + sync logic all work end-to-end before
 * relying on Vercel + the GH Action.
 *
 * Usage: npx tsx scripts/test-pack-sync.ts
 */
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

async function main() {
  // Dynamic import so dotenv runs before supabase.ts reads env vars at
  // module-evaluation time.
  const { syncPack } = await import("../src/lib/knowledge/sync");
  const result = await syncPack("rokid");
  console.log("✓ Sync OK:", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("✗ Sync failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
