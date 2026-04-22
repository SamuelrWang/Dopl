/**
 * One-shot verifier for the seeded Rokid pack. Queries Supabase directly
 * via the service-role client and prints what each MCP tool would return.
 * Avoids needing the dev server up to confirm the data path.
 *
 * Usage: npx tsx scripts/verify-rokid-pack.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log("\n── kb_list_packs ──");
  const { data: packs, error: packErr } = await admin
    .from("knowledge_packs")
    .select("id, name, description, sdk_version, repo_url, last_synced_at");
  if (packErr) throw packErr;
  console.log(JSON.stringify(packs, null, 2));

  console.log("\n── kb_list({ pack: 'rokid' }) ──");
  const { data: files, error: fErr } = await admin
    .from("knowledge_pack_files")
    .select("path, title, summary, category, tags, updated_at")
    .eq("pack_id", "rokid")
    .order("path");
  if (fErr) throw fErr;
  console.log(JSON.stringify(files, null, 2));

  console.log("\n── kb_get({ pack: 'rokid', path: 'docs/sdk/camera.md' }) ──");
  const { data: file, error: gErr } = await admin
    .from("knowledge_pack_files")
    .select("*")
    .eq("pack_id", "rokid")
    .eq("path", "docs/sdk/camera.md")
    .maybeSingle();
  if (gErr) throw gErr;
  console.log(JSON.stringify(file, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
