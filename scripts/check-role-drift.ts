/**
 * Catch drift between the declarations of the workspace role SET that no
 * compiler can hold together.
 *
 * ⚠ **THE TWO TYPE DECLARATIONS BECAME ONE ON 2026-09-02 (v2 slice A13).** The
 * set now lives in `packages/contracts/src/workspaces.ts › WorkspaceRole`;
 * `src/features/workspaces/types.ts › Role` and
 * `packages/dopl-client/src/types.ts › WorkspaceRole` both RE-EXPORT it, and the
 * SDK's committed `dist/types.d.ts` therefore emits a re-export too. Those three
 * sites left this script — **not because they stopped mattering, but because a
 * re-export cannot disagree, and `extractUnion` would throw on one.** What is
 * left is everything the compiler still cannot reach:
 *
 *   - packages/contracts/src/workspaces.ts › `WorkspaceRole`   (the reference)
 *   - packages/mcp-server/src/tools/members-render.ts › `ROLE_ORDER` (Record keys)
 *
 * ⚠ **THREE MORE CLASSES OF DECLARATION JOINED ON 2026-08-26, AND EACH ONE HAD
 * ALREADY DRIFTED IN PRODUCTION.**
 *
 *   1. **THE COMMITTED `dist/` COPY.** `packages/mcp-server/dist/tools/
 *      members-render.js` is a TRACKED file (`git ls-files packages | grep dist`),
 *      it is what `main` actually imports, and during the guest-role wave it was
 *      hand-edited. The gate read only `src/`, so a `dist/` that disagreed with
 *      its own source was invisible. ⚠ A `Record` LITERAL survives compilation as
 *      a real object, which is why this one is still a site while the SDK's
 *      re-exported union is not.
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
 * ⚠ THIS SCRIPT GUARDS THREE FAMILIES, not one, and they share one read and one
 * CI step:
 *   A. the ROLE set (above)                        — `main`
 *   B. the workspace LIST-ITEM field set            — `checkWorkspaceMirror`
 *   C. `isStandardWorkspace`'s POSITIVE form        — `checkWorkspaceKind` (F-295)
 *   D. the CONTAINER-KIND mapping                   — `checkContainerKind` (R-32)
 *
 * ⚠ **B AND C ARE THE TWO THAT A13 COULD NOT DELETE, FOR DIFFERENT REASONS.** B
 * compares INTERFACE FIELD SETS between two DTOs that are legitimately different
 * shapes (the SDK's carries one recorded asymmetry, `iconUrl`, F-335); moving
 * either into `@dopl/contracts` would be unifying two types that were never the
 * same. C compares a RUNTIME PREDICATE, and `@dopl/contracts` is type-only — the
 * KIND SET it used to check alongside is now one declaration and is gone from
 * here, but the three copies of the function are not.
 *
 * Exits non-zero with a diff summary if any set drifts. Run via:
 *   npx tsx scripts/check-role-drift.ts
 */
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";

/**
 * Pull the string-literal members of `export type <Name> = "a" | "b" | …;`.
 *
 * ⚠ EXPORTED SINCE 2026-08-30 and imported by `check-knowledge-type-drift.ts`'s
 * shelf pass (G1). It is a `type` declaration reader, not a role reader — the
 * shelf unions are the same shape and a second copy of this regex is exactly
 * the class of duplication both scripts exist to catch. The `main()` call at
 * the bottom is guarded on `require.main` so importing this file runs the
 * helper and not the gate.
 */
export function extractUnion(source: string, typeName: string): string[] {
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

/**
 * 🔒 THE WORKSPACE-KIND MIRROR (F-295, gated 2026-08-30).
 *
 * `WorkspaceKind` and `isStandardWorkspace` exist TWICE — once in `src/`, once
 * in the SDK (plus the SDK's committed `dist/`, which is what `main` imports) —
 * and until this pass nothing read them: `grep -rn "isStandardWorkspace" scripts/`
 * answered zero. The bodies are byte-identical today only because both were
 * flipped together on 2026-08-24; consumers of the package copy went 3 → 6
 * during the /home wave and one of them is now a CONFIRM GATE
 * (`packages/mcp-server/src/tools/confirm-token.ts`), so a copy that drifts
 * decides whether a write into somebody else's room previews first.
 *
 * TWO things are asserted, and the second is not implied by the first:
 *   1. the KIND SET agrees across all three declarations;
 *   2. every copy of the predicate is the POSITIVE form. INVARIANTS §4A: the
 *      negative spelling (`!== "link"`) admits every kind added to the union
 *      LATER, silently, into the one place the predicate exists to keep kinds
 *      out of. A set-only check cannot see a coordinated flip to `!==`.
 */
/**
 * Pull the values of `CHECK (kind IN ('a','b',…))` on `workspaces`, from
 * whichever migration most recently re-declared `workspaces_kind_check`.
 *
 * ⚠ MOST RECENT BY FILENAME, which is the order the database replays in (§12):
 * the last file to `ADD CONSTRAINT` it is the constraint that wins, and reading
 * an earlier one would compare against history.
 */
function extractSqlKindValues(migrationsDir: string): { file: string; kinds: string[] } {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of [...files].reverse()) {
    // ⚠ **COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT A NICETY.** The file that
    // widened this CHECK carries its own ROLLBACK in a `--` block, which
    // re-states the constraint with the OLD two values — a naive read finds the
    // rollback first and reports the live migration as missing `personal`.
    const sql = readFileSync(resolve(migrationsDir, file), "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    // ⚠ And the LAST executable declaration wins, for the same reason the most
    // recent FILE does: a migration may drop and re-add within itself.
    const all = [
      ...sql.matchAll(
        /ADD\s+CONSTRAINT\s+workspaces_kind_check\s+CHECK\s*\(\s*kind\s+IN\s*\(([^)]*)\)/gi,
      ),
    ];
    if (all.length === 0) continue;
    const last = all[all.length - 1];
    return { file, kinds: [...last[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) };
  }
  throw new Error("no migration declares `workspaces_kind_check`");
}

/**
 * 🔒 **FAMILY D — THE CONTAINER KIND, ACROSS THREE DECLARATIONS THAT NO
 * COMPILER CAN HOLD TOGETHER** (R-32, Samuel 2026-09-17).
 *
 * ⚠ **THERE ARE TWO VOCABULARIES AND THAT IS THE WHOLE REASON THIS EXISTS.**
 * `WorkspaceKind` is what the COLUMN holds (`standard | link | personal`);
 * `ContainerKind` is what an AGENT is told (`workspace | home_channel |
 * personal`). Neither is derivable from the other, and the mapping between them
 * is one `switch`. So three things must agree:
 *
 *   1. `@dopl/contracts › WorkspaceKind` and the SQL `CHECK` hold the SAME set —
 *      a value the column can hold and the union cannot is cast into the union
 *      silently and takes every `default` branch, which is the exact failure
 *      `check-message-kind-drift.ts` exists for;
 *   2. `@dopl/contracts › ContainerKind` has exactly as many members as there
 *      are storable kinds — a kind with no agent-facing name is a container an
 *      agent cannot tell apart from a workspace;
 *   3. `workspace-directory.ts › containerKind` NAMES every storable kind. ⚠ Its
 *      `default` arm answers `workspace`, which fails SAFE for a fourth kind
 *      (an unknown container is not advertised as somebody else's room) and is
 *      exactly why a green compile proves nothing here: the `switch` is TOTAL
 *      whatever the column gains.
 */
function checkContainerKind(
  read: (rel: string) => string,
  migrationsDir: string,
): boolean {
  let drift = false;
  const contracts = read("packages/contracts/src/workspaces.ts");
  const storable = extractUnion(contracts, "WorkspaceKind");
  const agentFacing = extractUnion(contracts, "ContainerKind");
  const sql = extractSqlKindValues(migrationsDir);

  const missing = storable.filter((k) => !sql.kinds.includes(k));
  const extra = sql.kinds.filter((k) => !storable.includes(k));
  if (missing.length || extra.length) {
    drift = true;
    console.error(
      `[drift] \`WorkspaceKind\` vs supabase/migrations/${sql.file} › workspaces_kind_check:`,
    );
    if (missing.length) console.error(`  the CHECK lacks: ${missing.join(", ")}`);
    if (extra.length) console.error(`  the union lacks: ${extra.join(", ")}`);
  }

  if (agentFacing.length !== storable.length) {
    drift = true;
    console.error(
      `[drift] \`ContainerKind\` has ${agentFacing.length} member(s) for ${storable.length} storable kind(s) — every kind a row can hold needs exactly one agent-facing name.`,
    );
  }

  // ⚠ Read from the `switch`'s SOURCE, not from its behaviour: the `default`
  // arm makes every input resolve, so only the written arms are evidence.
  const mapper = read("packages/mcp-server/src/workspace-directory.ts");
  const body = mapper.slice(mapper.indexOf("export function containerKind("));
  for (const kind of storable) {
    // `standard` is the `default` arm by design — it is the fail-safe, and
    // naming it in a `case` would delete the fail-safe.
    if (kind === "standard") continue;
    if (!body.includes(`case "${kind}":`)) {
      drift = true;
      console.error(
        `[drift] packages/mcp-server/src/workspace-directory.ts › containerKind has no \`case "${kind}"\` — it would fall to the \`default\` arm and be advertised as a workspace.`,
      );
    }
  }

  if (!drift) {
    console.log(
      `✅ Container kind: ${storable.join(", ")} (column) ↔ ${agentFacing.join(", ")} (agent-facing), one mapping, matching supabase/migrations/${sql.file}.`,
    );
  }
  return drift;
}

function checkWorkspaceKind(read: (rel: string) => string): boolean {
  let drift = false;

  // ⚠ The `dist/` copy checked here is `types.js`, the EMITTED BODY — the
  // `.d.ts` carries only a signature, so a `dist/` whose runtime predicate was
  // hand-edited would pass a declaration-only read.
  const POSITIVE = /\(\s*workspace\.kind\s*\?\?\s*"standard"\s*\)\s*===\s*"standard"/;
  for (const file of [
    "src/features/workspaces/types.ts",
    "packages/dopl-client/src/types.ts",
    "packages/dopl-client/dist/types.js",
  ]) {
    if (!POSITIVE.test(read(file))) {
      drift = true;
      console.error(
        `[drift] ${file} › isStandardWorkspace is not the POSITIVE form \`(kind ?? "standard") === "standard"\` (INVARIANTS §4A, F-295).`
      );
    }
  }

  if (!drift) {
    console.log(
      "✅ All 3 isStandardWorkspace copies are the positive form (the KIND SET itself is now one declaration — `@dopl/contracts`)."
    );
  }
  return drift;
}

function main(): void {
  const root = resolve(__dirname, "..");
  const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

  const server = extractUnion(
    read("packages/contracts/src/workspaces.ts"),
    "WorkspaceRole"
  );
  const mcp = extractRecordKeys(
    read("packages/mcp-server/src/tools/members-render.ts"),
    "ROLE_ORDER"
  );
  const sql = extractSqlRoleArms(resolve(root, "supabase/migrations"));

  const sources: Array<[string, string[]]> = [
    ["packages/contracts/src/workspaces.ts › WorkspaceRole", server],
    ["packages/mcp-server/src/tools/members-render.ts › ROLE_ORDER", mcp],
    // ── the committed dist/ mirror: what `main` actually imports. ⚠ The SDK's
    //    `dist/types.d.ts` is NOT here any more: it re-exports `@dopl/contracts`,
    //    so there is no literal union in it left to drift (A13). This one stays
    //    because a `Record` LITERAL still compiles into `dist/` as a real object.
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
      "\n❌ Workspace role drift detected. Every declaration above — `@dopl/contracts`, the role-keyed decision maps in both trees (source AND committed dist/) and the SQL rank CASE — must carry the same role SET."
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

  // The FOURTH family — R-32's typed container kind, and the one gate that
  // compares a TypeScript union against a SQL `CHECK` on this table.
  if (checkContainerKind(read, resolve(root, "supabase/migrations"))) {
    console.error(
      "\n❌ Container kind drift detected (R-32). `@dopl/contracts › WorkspaceKind` is what the column holds and `› ContainerKind` is what an agent is told; the two sets, the `workspaces_kind_check` CHECK and `workspace-directory.ts › containerKind`'s arms must move together, in ONE change.",
    );
    process.exit(1);
  }

  // The THIRD family — same two files again, same reason (F-295).
  if (checkWorkspaceKind(read)) {
    console.error(
      "\n❌ `isStandardWorkspace` drift detected (F-295). The PREDICATE is still hand-mirrored across src, the SDK and its committed dist/ — `@dopl/contracts` is type-only and cannot hold a function — so change every copy in ONE change, keep the POSITIVE spelling, and rebuild with `npm run build -w @dopl/client`."
    );
    process.exit(1);
  }
}

// ⚠ Guarded: `check-knowledge-type-drift.ts` imports `extractUnion` from here,
// and an unguarded call would run this whole gate as a side effect of that
// import — two gates behind one exit code, and a role failure reported under a
// knowledge heading.
if (require.main === module) main();
