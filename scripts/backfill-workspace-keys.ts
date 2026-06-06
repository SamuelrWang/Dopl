/**
 * One-off backfill: mint one fresh, encrypted, workspace-scoped API key
 * for every active workspace membership that lacks an active key.
 *
 * Run AFTER the clean-slate migration (20260604020000) has revoked the
 * old keys. Idempotent — `ensureWorkspaceKey` skips any (user, workspace)
 * that already has an active key, so this is safe to re-run.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and
 * API_KEY_ENCRYPTION_KEY in .env.local.
 *
 * Run: npx tsx scripts/backfill-workspace-keys.ts
 */
import * as dotenv from "dotenv";
import { resolve } from "path";

// Load env before importing any module that reads process.env at init.
dotenv.config({ path: resolve(__dirname, "../.env.local") });

if (
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY
) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
  );
  process.exit(1);
}
if (!process.env.API_KEY_ENCRYPTION_KEY) {
  console.error("Missing API_KEY_ENCRYPTION_KEY in .env.local");
  process.exit(1);
}

type MemberRow = { user_id: string; workspace_id: string };

async function main() {
  const { supabaseAdmin } = await import("../src/shared/supabase/admin");
  const { ensureWorkspaceKey } = await import("../src/shared/auth/api-keys");
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("workspace_members")
    .select("user_id, workspace_id")
    .eq("status", "active");
  if (error) throw error;

  const members = (data ?? []) as MemberRow[];
  console.log(`Processing ${members.length} active memberships…`);

  let ok = 0;
  let failed = 0;
  for (const m of members) {
    try {
      await ensureWorkspaceKey(m.user_id, m.workspace_id);
      ok += 1;
    } catch (e) {
      failed += 1;
      console.error(
        `  failed for user=${m.user_id} workspace=${m.workspace_id}:`,
        e instanceof Error ? e.message : e
      );
    }
  }
  console.log(`Backfill done — ${ok} ok, ${failed} failed.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
