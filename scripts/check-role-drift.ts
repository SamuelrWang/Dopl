/**
 * Catch drift between the hand-mirrored declarations of the workspace role SET.
 * There is no shared module across the server, the SDK, the MCP package and the
 * DATABASE (the SDK and MCP cannot import from `src/`; SQL can import nothing),
 * so the same list of role names is re-typed in several places and nothing but
 * this script keeps them equal:
 *
 *   - src/features/workspaces/types.ts          › `Role`         (source of truth)
 *   - packages/dopl-client/src/types.ts         › `WorkspaceRole`
 *   - packages/mcp-server/src/tools/members-render.ts › `ROLE_ORDER` (Record keys)
 *
 * ⚠ **THREE MORE CLASSES OF DECLARATION JOINED ON 2026-08-26, AND EACH ONE HAD
 * ALREADY DRIFTED IN PRODUCTION.**
 *
 *   1. **THE COMMITTED `dist/` COPIES.** `packages/dopl-client/dist/types.d.ts`
 *      and `packages/mcp-server/dist/tools/members-render.js` are TRACKED files
 *      (`git ls-files packages | grep dist`), they are what `main` actually imports,
 *      and during the guest-role wave they were hand-edited. The gate read only
 *      `src/`, so a `dist/` that disagreed with its own source was invisible.
 *   2. **THE SQL RANK FUNCTION.** `public.is_workspace_member`'s `CASE` is a
 *      THIRD scale and it governs every RLS policy. Its arms are read out of the
 *      migration that last defined it.
 *   3. **ROLE-CONSUMING LOGIC, NOT JUST THE SET.** `members-render.ts ›
 *      DEFAULT_LEVEL` and `src/features/teams/access-levels.ts ›
 *      ROLE_DEFAULT_LEVEL` DECIDE something per role. Both were open `else`
 *      branches until 2026-08-26, and both silently gave `guest` a viewer's
 *      answer — one of them the most privileged value in its enum. A set-only
 *      gate cannot see that class of bug; a keys-must-cover-`Role` gate can.
 *
 * ⚠ This guards the SET of role NAMES and the KEY COVERAGE of role-keyed maps —
 * never the numeric ranks. The scales are DELIBERATELY different: `ROLE_RANK`
 * (server) is higher = more privilege, `ROLE_ORDER` (MCP) is REVERSED (lower =
 * higher, it drives roster sort order), and the SQL scheme differs again
 * (`guest` at -1, keeping every pre-existing number unchanged). No number ever
 * crosses a boundary; only the names must agree.
 * `ROLE_RANK` itself is `Record<Role, number>`, so the compiler already forces
 * it to cover `Role` — that pair needs no runtime guard and is intentionally not
 * checked here. The two `Record<Role, …>` maps in (3) are compiler-forced for
 * the same reason **in `src/`**; they are checked anyway because the mirror in
 * `dist/` is not, and because the check states the requirement where a reader
 * of this file will look for it.
 *
 * Exits non-zero with a diff summary if any set drifts. Run via:
 *   npx tsx scripts/check-role-drift.ts
 */
import { readFileSync, readdirSync } from "fs";
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

/**
 * Pull the arms of the SQL `CASE m.role … END` inside `is_workspace_member`,
 * from whichever migration most recently re-defined the function.
 *
 * ⚠ MOST RECENT BY FILENAME, and that is the ordering the database replays in
 * (§12) — so the last file to `CREATE OR REPLACE` it is the definition that
 * wins. Reading an earlier one would compare against history.
 */
function extractSqlRoleArms(migrationsDir: string): { file: string; roles: string[] } {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of [...files].reverse()) {
    const sql = readFileSync(resolve(migrationsDir, file), "utf8");
    if (!/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.is_workspace_member/i.test(sql)) {
      continue;
    }
    // The FIRST `CASE m.role … END` — the member's own rank. The second CASE
    // maps the min-role ARGUMENT and legitimately carries the legacy `editor`
    // alias, which is not a role in the set.
    const block = /CASE\s+m\.role([\s\S]*?)END/i.exec(sql);
    if (!block) break;
    return {
      file,
      roles: [...block[1].matchAll(/WHEN\s+'([a-z_]+)'/gi)].map((m) => m[1]),
    };
  }
  throw new Error(
    "no migration defines is_workspace_member — the SQL rank scale is unreadable"
  );
}

/**
 * Strip block and line comments, so a docblock's `{@link …}` cannot be mistaken
 * for structure and a commented-out field cannot be mistaken for a real one.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * Pull the declared PROPERTY NAMES of `export interface <Name> { … }`, following
 * the brace depth rather than matching to the first `}` — these interfaces carry
 * docblocks full of `{@link …}` and inline object types, and a lazy match
 * silently truncates the field list, which would make this gate pass by seeing
 * nothing.
 */
function extractInterfaceKeys(source: string, name: string): string[] {
  const clean = stripComments(source);
  const start = clean.search(new RegExp(`\\binterface\\s+${name}\\b`));
  if (start === -1) throw new Error(`could not find \`interface ${name}\``);
  const open = clean.indexOf("{", start);
  if (open === -1) throw new Error(`\`interface ${name}\` has no body`);
  let depth = 0;
  let end = open;
  for (let i = open; i < clean.length; i += 1) {
    if (clean[i] === "{") depth += 1;
    else if (clean[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = clean.slice(open + 1, end);
  // Only TOP-LEVEL properties: a nested inline object's keys are not fields of
  // this interface.
  const out: string[] = [];
  let nest = 0;
  for (const line of body.split("\n")) {
    if (nest === 0) {
      const m = /^\s*(\w+)\??\s*:/.exec(line);
      if (m) out.push(m[1]);
    }
    for (const ch of line) {
      if (ch === "{") nest += 1;
      else if (ch === "}") nest -= 1;
    }
  }
  return out;
}

/**
 * 🔒 THE WORKSPACE LIST-ITEM MIRROR (Home Knowledge Panels M5, 2026-08-26).
 *
 * `GET /api/workspaces`'s row type is hand-mirrored across the server and the
 * SDK — `src/features/workspaces/types.ts › Workspace`+`WorkspaceWithRole`
 * against `packages/dopl-client/src/types.ts › WorkspaceSummary`+
 * `WorkspaceListItem` — and until this check existed **NOTHING GUARDED IT.**
 * `check-role-drift` compared the role SET; `check-knowledge-type-drift` covers
 * knowledge types; neither looks at this pair. The field that made it matter is
 * `memberCount`, which the MCP directory lock reads at boot: a server that stops
 * sending it, or an SDK that stops declaring it, silently changes how much of a
 * workspace directory an agent is shown, with no error anywhere.
 *
 * ⚠ **`iconUrl` IS A REAL, PRE-EXISTING ASYMMETRY AND IS RECORDED, NOT FIXED.**
 * The server DTO (`workspaces/server/dto.ts › mapWorkspaceRow`) emits it on
 * every row and the SDK type has never declared it, so the wire has carried a
 * field the SDK cannot see since before this gate. Widening the SDK type is a
 * separate change with its own `dist/` rebuild; softening the gate to hide it
 * would destroy the evidence (CLAUDE.md's rule). **THIS LIST MAY ONLY EVER
 * SHRINK.** F-335.
 */
const WORKSPACE_MIRROR_ALLOWED_DRIFT = ["iconUrl"];

function checkWorkspaceMirror(read: (rel: string) => string): boolean {
  const serverFields = [
    ...extractInterfaceKeys(read("src/features/workspaces/types.ts"), "Workspace"),
    ...extractInterfaceKeys(
      read("src/features/workspaces/types.ts"),
      "WorkspaceWithRole"
    ),
  ];
  const mirrors: Array<[string, string[]]> = [
    [
      "packages/dopl-client/src/types.ts › WorkspaceSummary + WorkspaceListItem",
      [
        ...extractInterfaceKeys(
          read("packages/dopl-client/src/types.ts"),
          "WorkspaceSummary"
        ),
        ...extractInterfaceKeys(
          read("packages/dopl-client/src/types.ts"),
          "WorkspaceListItem"
        ),
      ],
    ],
    [
      "packages/dopl-client/dist/types.d.ts › WorkspaceSummary + WorkspaceListItem",
      [
        ...extractInterfaceKeys(
          read("packages/dopl-client/dist/types.d.ts"),
          "WorkspaceSummary"
        ),
        ...extractInterfaceKeys(
          read("packages/dopl-client/dist/types.d.ts"),
          "WorkspaceListItem"
        ),
      ],
    ],
  ];

  const allowed = new Set(WORKSPACE_MIRROR_ALLOWED_DRIFT);
  const reference = new Set(serverFields);
  let drift = false;
  for (const [label, fields] of mirrors) {
    const set = new Set(fields);
    const missing = [...reference].filter((f) => !set.has(f) && !allowed.has(f));
    const extra = [...set].filter((f) => !reference.has(f) && !allowed.has(f));
    if (missing.length || extra.length) {
      drift = true;
      console.error(`[drift] ${label}:`);
      if (missing.length) console.error(`  missing field(s): ${missing.join(", ")}`);
      if (extra.length) console.error(`  extra field(s):   ${extra.join(", ")}`);
    }
  }
  if (!drift) {
    console.log(
      `✅ Workspace list-item mirror agrees on ${reference.size} field(s); ${allowed.size} recorded asymmetry (${WORKSPACE_MIRROR_ALLOWED_DRIFT.join(", ")}, F-335).`
    );
  }
  return drift;
}

function main(): void {
  const root = resolve(__dirname, "..");
  const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

  const server = extractUnion(read("src/features/workspaces/types.ts"), "Role");
  const sdk = extractUnion(read("packages/dopl-client/src/types.ts"), "WorkspaceRole");
  const mcp = extractRecordKeys(
    read("packages/mcp-server/src/tools/members-render.ts"),
    "ROLE_ORDER"
  );
  const sql = extractSqlRoleArms(resolve(root, "supabase/migrations"));

  const sources: Array<[string, string[]]> = [
    ["src/features/workspaces/types.ts › Role", server],
    ["packages/dopl-client/src/types.ts › WorkspaceRole", sdk],
    ["packages/mcp-server/src/tools/members-render.ts › ROLE_ORDER", mcp],
    // ── the committed dist/ mirrors: what `main` actually imports ──
    [
      "packages/dopl-client/dist/types.d.ts › WorkspaceRole",
      extractUnion(read("packages/dopl-client/dist/types.d.ts"), "WorkspaceRole"),
    ],
    [
      "packages/mcp-server/dist/tools/members-render.js › ROLE_ORDER",
      extractRecordKeys(
        read("packages/mcp-server/dist/tools/members-render.js"),
        "ROLE_ORDER"
      ),
    ],
    // ── role-CONSUMING maps: a missing key is a silent wrong decision ──
    [
      "packages/mcp-server/src/tools/members-render.ts › DEFAULT_LEVEL",
      extractRecordKeys(
        read("packages/mcp-server/src/tools/members-render.ts"),
        "DEFAULT_LEVEL"
      ),
    ],
    [
      "packages/mcp-server/dist/tools/members-render.js › DEFAULT_LEVEL",
      extractRecordKeys(
        read("packages/mcp-server/dist/tools/members-render.js"),
        "DEFAULT_LEVEL"
      ),
    ],
    [
      "src/features/teams/access-levels.ts › ROLE_DEFAULT_LEVEL",
      extractRecordKeys(
        read("src/features/teams/access-levels.ts"),
        "ROLE_DEFAULT_LEVEL"
      ),
    ],
    // ── the database's own scale ──
    [`supabase/migrations/${sql.file} › is_workspace_member CASE`, sql.roles],
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
      "\n❌ Workspace role drift detected. Every declaration above — src, the committed dist/ mirrors, the role-keyed decision maps and the SQL rank CASE — must carry the same role SET."
    );
    process.exit(1);
  }
  console.log(
    `✅ All ${sources.length} role declarations agree on the set: ${[...reference].sort().join(", ")}.`
  );

  // The SECOND family this script guards — see `checkWorkspaceMirror`. It is in
  // this file rather than a sibling because it reads the same two hand-mirrored
  // type files for the same reason, and CI runs this step already.
  if (checkWorkspaceMirror(read)) {
    console.error(
      "\n❌ Workspace list-item mirror drift detected. `src/features/workspaces/types.ts` and `packages/dopl-client/src/types.ts` (plus its committed dist/ mirror) are hand-mirrored: change every side in ONE change, and rebuild with `npm run build -w @dopl/client`."
    );
    process.exit(1);
  }
}

main();
