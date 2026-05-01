/**
 * Scope an existing API key to a single workspace (Item 4).
 *
 * Until Item 5 ships a UI for this, this is the way to lock an MCP
 * key to one workspace. Useful for verifying the workspace-scoped
 * auth flow against the dev server.
 *
 * Usage:
 *   npx tsx scripts/scope-api-key.ts --key-prefix=sk-dopl-abc --workspace=<uuid>
 *   npx tsx scripts/scope-api-key.ts --key-prefix=sk-dopl-abc --clear   # remove scoping
 *   npx tsx scripts/scope-api-key.ts --list                              # list user's keys
 *
 * `--key-prefix` matches the start of the key (the value shown in the
 * UI under "API Keys" — typically 12 chars). The script picks the most
 * recent active key whose `key_prefix` starts with that string.
 */
import * as dotenv from "dotenv";
import { resolve } from "path";

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

interface Args {
  list: boolean;
  clear: boolean;
  keyPrefix: string | null;
  workspaceId: string | null;
}

function parseArgs(argv: string[]): Args {
  let list = false;
  let clear = false;
  let keyPrefix: string | null = null;
  let workspaceId: string | null = null;
  for (const a of argv.slice(2)) {
    if (a === "--list") list = true;
    else if (a === "--clear") clear = true;
    else if (a.startsWith("--key-prefix=")) keyPrefix = a.slice("--key-prefix=".length);
    else if (a.startsWith("--workspace=")) workspaceId = a.slice("--workspace=".length);
    else if (a === "-h" || a === "--help") {
      console.log(
        "Usage:\n" +
          "  --list                                # list active keys\n" +
          "  --key-prefix=sk-dopl-abc --workspace=<uuid>  # set workspace_id\n" +
          "  --key-prefix=sk-dopl-abc --clear      # clear workspace_id"
      );
      process.exit(0);
    }
  }
  return { list, clear, keyPrefix, workspaceId };
}

async function main() {
  const args = parseArgs(process.argv);
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  if (args.list) {
    const { data, error } = await admin
      .from("api_keys")
      .select("id, name, key_prefix, user_id, workspace_id, last_used_at, revoked_at")
      .is("revoked_at", null)
      .order("last_used_at", { ascending: false, nullsFirst: false });
    if (error) {
      console.error(error.message);
      process.exit(1);
    }
    for (const row of data ?? []) {
      const ws = row.workspace_id ? row.workspace_id : "(user-scoped)";
      console.log(
        `${row.key_prefix}…  name=${row.name}  user=${row.user_id?.slice(0, 8)}…  workspace=${ws}`
      );
    }
    return;
  }

  if (!args.keyPrefix) {
    console.error("Pass --key-prefix=<start-of-key> or --list");
    process.exit(1);
  }
  if (!args.clear && !args.workspaceId) {
    console.error("Pass --workspace=<uuid> or --clear");
    process.exit(1);
  }

  const { data: matches, error: lookupErr } = await admin
    .from("api_keys")
    .select("id, name, key_prefix, workspace_id")
    .ilike("key_prefix", `${args.keyPrefix}%`)
    .is("revoked_at", null)
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .limit(5);
  if (lookupErr) {
    console.error(lookupErr.message);
    process.exit(1);
  }
  if (!matches || matches.length === 0) {
    console.error(`No active key matches prefix "${args.keyPrefix}".`);
    process.exit(1);
  }
  const target = matches[0];

  const next = args.clear ? null : args.workspaceId;
  const { error: updateErr } = await admin
    .from("api_keys")
    .update({ workspace_id: next })
    .eq("id", target.id);
  if (updateErr) {
    console.error(updateErr.message);
    process.exit(1);
  }
  console.log(
    `✅ ${target.key_prefix}… (${target.name}) → workspace_id = ${
      next ?? "NULL (user-scoped)"
    }`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
