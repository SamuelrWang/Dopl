/**
 * Catch drift between the THREE hand-mirrored declarations of the workspace
 * role SET. There is no shared module across the server, the SDK and the MCP
 * package (the SDK and MCP cannot import from `src/`), so the same list of role
 * names is re-typed in three places and nothing but this script keeps them
 * equal:
 *
 *   - src/features/workspaces/types.ts          › `Role`         (source of truth)
 *   - packages/dopl-client/src/types.ts         › `WorkspaceRole`
 *   - packages/mcp-server/src/tools/members-render.ts › `ROLE_ORDER` (Record keys)
 *
 * ⚠ This guards the SET of role NAMES, not the numeric ranks. The three carry
 * DELIBERATELY different numbering schemes — `ROLE_RANK` (in the server file) is
 * higher = more privilege, `ROLE_ORDER` (MCP) is REVERSED (lower = higher, it
 * drives roster sort order), and the SQL `is_workspace_member` scheme differs
 * again. No number ever crosses a boundary; only the role names must agree.
 * `ROLE_RANK` itself is `Record<Role, number>`, so the compiler already forces
 * it to cover `Role` — that pair needs no runtime guard and is intentionally not
 * checked here.
 *
 * Exits non-zero with a diff summary if any set drifts. Run via:
 *   npx tsx scripts/check-role-drift.ts
 */
import { readFileSync } from "fs";
import { resolve } from "path";

/** Pull the string-literal members of `export type <Name> = "a" | "b" | …;`. */
function extractUnion(source: string, typeName: string): string[] {
  const re = new RegExp(`export\\s+type\\s+${typeName}\\s*=([^;]+);`);
  const m = source.match(re);
  if (!m) throw new Error(`could not find \`export type ${typeName}\` in source`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** Pull the keys of `const ROLE_ORDER…= { owner: 0, admin: 1, … };`. */
function extractRecordKeys(source: string, constName: string): string[] {
  const re = new RegExp(`${constName}[^=]*=\\s*\\{([^}]*)\\}`);
  const m = source.match(re);
  if (!m) throw new Error(`could not find \`${constName} = { … }\` in source`);
  return [...m[1].matchAll(/(\w+)\s*:/g)].map((x) => x[1]);
}

function main(): void {
  const root = resolve(__dirname, "..");
  const server = extractUnion(
    readFileSync(resolve(root, "src/features/workspaces/types.ts"), "utf8"),
    "Role"
  );
  const sdk = extractUnion(
    readFileSync(resolve(root, "packages/dopl-client/src/types.ts"), "utf8"),
    "WorkspaceRole"
  );
  const mcp = extractRecordKeys(
    readFileSync(resolve(root, "packages/mcp-server/src/tools/members-render.ts"), "utf8"),
    "ROLE_ORDER"
  );

  const sources: Array<[string, string[]]> = [
    ["src/features/workspaces/types.ts › Role", server],
    ["packages/dopl-client/src/types.ts › WorkspaceRole", sdk],
    ["packages/mcp-server/src/tools/members-render.ts › ROLE_ORDER", mcp],
  ];

  // The server `Role` union is the reference set.
  const reference = new Set(server);
  let drift = false;
  for (const [label, roles] of sources) {
    const set = new Set(roles);
    const missing = [...reference].filter((r) => !set.has(r));
    const extra = [...set].filter((r) => !reference.has(r));
    if (missing.length || extra.length) {
      drift = true;
      console.error(`[drift] ${label}:`);
      if (missing.length) console.error(`  missing role(s): ${missing.join(", ")}`);
      if (extra.length) console.error(`  extra role(s):   ${extra.join(", ")}`);
    }
  }

  if (drift) {
    console.error(
      "\n❌ Workspace role drift detected. Keep Role / WorkspaceRole / ROLE_ORDER on the same role SET."
    );
    process.exit(1);
  }
  console.log(
    `✅ All 3 role declarations agree on the set: ${[...reference].sort().join(", ")}.`
  );
}

main();
