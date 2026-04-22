/**
 * Seed the Rokid AR knowledge pack.
 *
 * Usage:
 *   npx tsx scripts/seed-rokid-pack.ts                  # register + stub files
 *   npx tsx scripts/seed-rokid-pack.ts --sync           # register + pull from GH
 *   npx tsx scripts/seed-rokid-pack.ts --reset          # delete + recreate
 *
 * Default mode (no flags): registers the pack metadata and inserts 3 stub
 * files so the /api/knowledge/packs/* routes can be smoke-tested before
 * the dopl/rokid-knowledge GitHub repo exists. Once the repo is up, run
 * with --sync to pull the real content.
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SHOULD_SYNC = process.argv.includes("--sync");
const SHOULD_RESET = process.argv.includes("--reset");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const PACK_ID = "rokid";
const REPO_OWNER = "doplintelligence";
const REPO_NAME = "rokid-knowledge";
const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;

const STUB_FILES = [
  {
    path: "OVERVIEW.md",
    title: "Rokid AR Development — Overview",
    summary: "High-level concepts, key APIs, and pitfalls when developing for Rokid AR glasses.",
    body:
      "# Rokid AR Development — Overview\n\nThis is a stub OVERVIEW.md inserted by seed-rokid-pack.ts before the dopl/rokid-knowledge repo exists. Replace by running `npx tsx scripts/seed-rokid-pack.ts --sync` once the repo is live.\n",
    category: null as string | null,
    tags: ["overview"],
    frontmatter: { title: "Rokid AR Development — Overview" },
  },
  {
    path: "docs/sdk/camera.md",
    title: "Camera API",
    summary: "Capturing video and still frames from the Rokid glasses' onboard camera.",
    body:
      "# Camera API\n\n_Stub — will be replaced by the real doc on first sync._\n\n## Quick start\n```kotlin\n// example\n```\n",
    category: "sdk",
    tags: ["camera", "video", "sensor"],
    frontmatter: { title: "Camera API", tags: ["camera", "video", "sensor"] },
  },
  {
    path: "docs/sdk/gestures.md",
    title: "Gesture Recognition",
    summary: "Hand-tracking and gesture events from the Rokid SDK.",
    body:
      "# Gesture Recognition\n\n_Stub — will be replaced by the real doc on first sync._\n",
    category: "sdk",
    tags: ["gestures", "input"],
    frontmatter: { title: "Gesture Recognition", tags: ["gestures", "input"] },
  },
];

async function main() {
  if (SHOULD_RESET) {
    console.log("Resetting pack 'rokid'…");
    const { error } = await admin.from("knowledge_packs").delete().eq("id", PACK_ID);
    if (error) {
      console.error("Reset failed:", error.message);
      process.exit(1);
    }
    console.log("  deleted (cascade dropped files).");
  }

  // Upsert pack metadata. Idempotent.
  console.log(`Upserting pack '${PACK_ID}'…`);
  const { error: packErr } = await admin.from("knowledge_packs").upsert(
    {
      id: PACK_ID,
      name: "Rokid AR Glasses",
      description: "Specialist reference docs for developing on Rokid AR glasses (SDK, camera, gestures, hardware).",
      sdk_version: "1.x",
      repo_url: REPO_URL,
      repo_owner: REPO_OWNER,
      repo_name: REPO_NAME,
      default_branch: "main",
      manifest: null,
    },
    { onConflict: "id" }
  );
  if (packErr) {
    console.error("Pack upsert failed:", packErr.message);
    process.exit(1);
  }
  console.log("  ok.");

  if (SHOULD_SYNC) {
    console.log("Syncing from GitHub…");
    // Lazy import so the script still runs without the GH token in stub mode.
    const { syncPack } = await import("../src/lib/knowledge/sync");
    try {
      const result = await syncPack(PACK_ID);
      console.log(`  synced: ${result.files_synced} files, ${result.files_deleted} removed @ ${result.commit_sha.slice(0, 7)}`);
    } catch (err) {
      console.error("Sync failed:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  } else {
    console.log("Inserting stub files (use --sync once the repo exists)…");
    for (const f of STUB_FILES) {
      const { error } = await admin.from("knowledge_pack_files").upsert(
        {
          pack_id: PACK_ID,
          path: f.path,
          title: f.title,
          summary: f.summary,
          body: f.body,
          frontmatter: f.frontmatter,
          tags: f.tags,
          category: f.category,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "pack_id,path" }
      );
      if (error) {
        console.error(`  ${f.path} failed: ${error.message}`);
        process.exit(1);
      }
      console.log(`  ${f.path}`);
    }
  }

  console.log("\nDone. Smoke test:");
  console.log("  curl -H 'Authorization: Bearer sk-dopl-…' http://localhost:3000/api/knowledge/packs");
  console.log("  curl -H 'Authorization: Bearer sk-dopl-…' http://localhost:3000/api/knowledge/packs/rokid/files");
  console.log("  curl -H 'Authorization: Bearer sk-dopl-…' 'http://localhost:3000/api/knowledge/packs/rokid/file?path=docs/sdk/camera.md'");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
