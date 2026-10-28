/**
 * Seed the INTERNAL "Dopl App" developer org + project + live/test secret keys (W0.1,
 * Plans/Dopl SDK Split). Logic: `src/features/device-sdk/server/seed-dopl-app.ts` (idempotent:
 * re-runs keep what exists and never re-mint a usable key).
 *
 * Needs migration `20261122800000_device_sdk_internal_orgs.sql` applied to the target first.
 *
 * DRY RUN by default. `--apply` writes.
 *
 * Run:  set -a; source .env.local; set +a; \
 *       NODE_OPTIONS="--require $PWD/scripts/stub-server-only.cjs" \
 *       npx tsx scripts/seed-dopl-app.mts --owner-user-id <uuid> [--apply]
 *
 * ⚠ Newly minted raw keys are printed ONCE, to this terminal only. Never paste them into a
 * channel, KB, commit, log or file. The live key goes into Vercel env `DOPL_APP_SDK_KEY` by hand.
 */
import { seedDoplApp } from "../src/features/device-sdk/server/seed-dopl-app";
import {
  assertInternalOrgsSchema,
  supabaseDoplAppSeedStore,
} from "../src/features/device-sdk/server/seed-dopl-app-store";
import { supabaseAdmin } from "../src/shared/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv: string[]): { ownerUserId: string; apply: boolean } {
  let ownerUserId = "";
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") apply = true;
    else if (a === "--owner-user-id") ownerUserId = argv[++i] ?? "";
    else if (a.startsWith("--owner-user-id=")) ownerUserId = a.slice("--owner-user-id=".length);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!UUID.test(ownerUserId)) throw new Error("--owner-user-id <uuid> is required");
  return { ownerUserId, apply };
}

async function main() {
  const { ownerUserId, apply } = parseArgs(process.argv.slice(2));
  const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://unset").host;
  console.log(`target: ${host}  mode: ${apply ? "APPLY (writes)" : "dry run (read only)"}`);

  const { data: owner, error } = await supabaseAdmin().auth.admin.getUserById(ownerUserId);
  if (error || !owner?.user) throw new Error(`owner ${ownerUserId} not found: ${error?.message ?? "no user"}`);
  console.log(`owner: ${owner.user.id}`);

  await assertInternalOrgsSchema();
  const result = await seedDoplApp(supabaseDoplAppSeedStore(), { ownerUserId, apply });

  for (const s of result.steps) console.log(`  ${s.action.padEnd(6)} ${s.what}`);
  console.log(`org: ${result.orgId ?? "(would create)"}  project: ${result.projectId ?? "(would create)"}`);

  if (result.minted.length > 0) {
    console.log("\n==== NEW KEYS: shown ONCE. Copy now. Never paste into a channel, KB, commit or file. ====");
    for (const k of result.minted) console.log(`  ${k.env.padEnd(4)} ${k.secret}`);
    console.log("==== live key -> Vercel env DOPL_APP_SDK_KEY (by hand). ====\n");
  } else if (apply) {
    console.log("no new keys minted (usable keys already exist; rotate on purpose to get a new one).");
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
