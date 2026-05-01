/**
 * Seed knowledge bases into one or all workspaces using the canonical
 * fixtures (`HARDCODED_KBS`). Idempotent — workspaces that already
 * have any active base are skipped.
 *
 * Usage:
 *   NODE_OPTIONS='--conditions=react-server' npx tsx scripts/seed-knowledge-bases.ts --workspace=<uuid>
 *   NODE_OPTIONS='--conditions=react-server' npx tsx scripts/seed-knowledge-bases.ts --all
 *
 * The `--conditions=react-server` flag makes Node resolve `server-only`
 * to its no-op variant. Without it, the standalone `server-only`
 * package throws on import (it's normally aliased by the Next.js
 * bundler, not loaded by Node directly).
 *
 * New workspaces don't need this script — they get a lazy seed on the
 * first call to `service.listBases`. Use this only to backfill
 * workspaces that pre-date the knowledge-base feature, or to re-seed
 * after a manual cleanup.
 */
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
  );
  process.exit(1);
}

interface Args {
  workspace: string | null;
  all: boolean;
}

function parseArgs(argv: string[]): Args {
  let workspace: string | null = null;
  let all = false;
  for (const arg of argv.slice(2)) {
    if (arg === "--all") all = true;
    else if (arg.startsWith("--workspace=")) workspace = arg.slice("--workspace=".length);
    else if (arg === "--help" || arg === "-h") {
      printHelpAndExit(0);
    }
  }
  return { workspace, all };
}

function printHelpAndExit(code: number): never {
  console.log(`Seed knowledge bases.

Usage:
  npx tsx scripts/seed-knowledge-bases.ts --workspace=<uuid>
  npx tsx scripts/seed-knowledge-bases.ts --all

Flags:
  --workspace=<uuid>   Seed one workspace by id. Skips if it already has any
                       active knowledge base.
  --all                Enumerate every workspace and seed each. Reports the
                       seeded / skipped counts at the end.
  -h, --help           Print this help.
`);
  process.exit(code);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.workspace && !args.all) printHelpAndExit(1);

  // Dynamic imports so dotenv.config runs before @/shared/supabase/admin
  // reads NEXT_PUBLIC_SUPABASE_URL at module load.
  const { createClient } = await import("@supabase/supabase-js");
  const { seedWorkspace, buildKnowledgeContext } = await import(
    "@/features/knowledge/server/service"
  );

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let workspaceIds: string[];

  if (args.workspace) {
    workspaceIds = [args.workspace];
  } else {
    const { data, error } = await admin
      .from("workspaces")
      .select("id, owner_id, name, slug")
      .order("created_at", { ascending: true });
    if (error) {
      console.error("Failed to list workspaces:", error.message);
      process.exit(1);
    }
    workspaceIds = (data ?? []).map((row) => row.id as string);
    console.log(`Found ${workspaceIds.length} workspace(s).`);
  }

  let seeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const workspaceId of workspaceIds) {
    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .select("id, owner_id, name, slug")
      .eq("id", workspaceId)
      .maybeSingle();
    if (wsErr || !workspace) {
      console.error(
        `  ❌ ${workspaceId}: ${wsErr ? wsErr.message : "workspace not found"}`
      );
      failed += 1;
      continue;
    }

    const ctx = buildKnowledgeContext({
      workspaceId: workspace.id as string,
      userId: (workspace.owner_id as string) ?? null,
      apiKeyId: null,
    });

    try {
      const result = await seedWorkspace(ctx);
      if (result.basesCreated === 0) {
        console.log(
          `  ⏭  ${workspace.slug ?? workspace.id} already has bases, skipped`
        );
        skipped += 1;
      } else {
        console.log(
          `  ✅ ${workspace.slug ?? workspace.id}: created ${result.basesCreated} base(s)`
        );
        seeded += 1;
      }
    } catch (err) {
      console.error(
        `  ❌ ${workspace.slug ?? workspace.id}:`,
        err instanceof Error ? err.message : err
      );
      failed += 1;
    }
  }

  console.log(`\nDone. seeded=${seeded} skipped=${skipped} failed=${failed}`);
  if (failed > 0) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
