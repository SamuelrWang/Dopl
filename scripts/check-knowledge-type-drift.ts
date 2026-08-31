/**
 * Audit fix #12: catch drift between the two hand-mirrored knowledge
 * domain-type files.
 *
 *   - src/features/knowledge/types.ts          (server-side, source-of-truth)
 *   - packages/dopl-client/src/knowledge-types.ts  (SDK; same shapes
 *                                                    re-declared so the
 *                                                    package is self-
 *                                                    contained)
 *
 * The proper fix is extracting these into a shared package, but until
 * that lands this script enforces that the field names of every shared
 * interface match. Field types and ordering can differ; presence and
 * naming cannot.
 *
 * Exits non-zero with a diff summary if any interface drifts. Run via:
 *
 *   npx tsx scripts/check-knowledge-type-drift.ts
 *
 * Wire into CI by adding `npx tsx scripts/check-knowledge-type-drift.ts`
 * as a step in `.github/workflows/packages.yml` (or a new web workflow).
 * (It IS wired — the `type-drift` job in `.github/workflows/ci.yml`.)
 *
 * ⚠ A SECOND FAMILY JOINED ON 2026-08-30: the SHELF vocabulary
 * (`checkShelfUnions` below). It is here rather than in a sibling script
 * because it reads the same two hand-mirrored knowledge type files, and CI
 * runs this step already.
 */
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
// ⚠ IMPORTED, NOT RE-TYPED. `check-role-drift.ts`'s `main()` is guarded on
// `require.main`, so this import brings the helper and not that gate.
import { extractUnion } from "./check-role-drift";

interface InterfaceDecl {
  name: string;
  fields: string[];
}

const SHARED_INTERFACES = [
  "KnowledgeBase",
  "KnowledgeFolder",
  "KnowledgeEntry",
  "KnowledgeTreeSnapshot",
] as const;

function extractInterfaces(source: string): Map<string, InterfaceDecl> {
  // Match: `export interface Name { ... }` (single-level body, no
  // method signatures). Stops at the first closing `}`. Adequate for
  // the flat shapes these files hold today.
  const out = new Map<string, InterfaceDecl>();
  const re = /export\s+interface\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const [, name, body] = match;
    const fields = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("//") && !l.startsWith("/*") && !l.startsWith("*"))
      .map((l) => {
        // strip trailing comment, semicolon, and pull the field name
        const cleaned = l.replace(/\/\/.*$/, "").trim().replace(/;$/, "");
        const m = cleaned.match(/^(\w+)(\?)?\s*:/);
        return m ? m[1] : null;
      })
      .filter((f): f is string => f !== null);
    out.set(name, { name, fields: fields.sort() });
  }
  return out;
}

/**
 * 🔒 THE SHELF VOCABULARY (G1, 2026-08-30). `/home` composes two shelves and
 * the WIRE noun for them is declared in NINE places with no gate between any
 * two of them.
 *
 * ⚠ WHY THIS ONE MATTERS MORE THAN A NORMAL MIRROR. The shelf is an
 * access-shaped FILTER, and every one of these sites is explicit that a value
 * it does not recognise answers the WIDER list — `?shelf=hom` folding the
 * workspace shelf back into the personal pane, looking like it worked. Drift
 * here does not break; it silently widens.
 *
 * FIVE CLASSES, and the last two are not `export type` declarations at all:
 *
 *   1. THE UNIONS — `KbShelf` and `TemplateShelf` in `src/`, mirrored again in
 *      the SDK. `agent-templates/types.ts › TemplateShelf`'s own docblock says
 *      it is "MIRRORED FROM `features/knowledge/types.ts › KbShelf`, NOT
 *      IMPORTED", which names the reference.
 *   2. THE COMMITTED `dist/` COPIES — what `main` and the MCP server actually
 *      import, hand-editable and invisible to a `src/`-only read (the lesson
 *      `check-role-drift.ts` already learned).
 *   3. THE ROUTE GUARDS — each `readShelf` re-types the two literals in a
 *      `raw === "…"` comparison, and each is the 400 that stops a misspelling
 *      from widening the answer.
 *   4. THE MCP MAPPER — `tools/shelf.ts › toWireShelf` is the ONE operator-noun
 *      → wire-noun translation. ⚠ Its ARGUMENT vocabulary (`SHELF_VALUES` =
 *      personal|workspace) is deliberately NOT the wire's and is not compared
 *      here; what must equal the union is the set of values the mapper can
 *      RETURN.
 *   5. THE DATABASE — there is no shelf column. The shelf is stored as the
 *      BOOLEAN `home_scoped`, so a boolean can encode exactly two shelves. A
 *      third member of the union is a migration, not a type edit, and this is
 *      the only place that says so.
 */
function checkShelfUnions(read: (rel: string) => string): boolean {
  const REFERENCE_FILE = "src/features/knowledge/types.ts";
  const reference = new Set(extractUnion(read(REFERENCE_FILE), "KbShelf"));

  /** The wire literals a `readShelf` guard admits — its `raw === "…"` arms. */
  function readShelfArms(source: string): string[] {
    const body = /function readShelf\([\s\S]*?\n\}/.exec(source);
    if (!body) throw new Error("could not find `function readShelf` in source");
    return [...body[0].matchAll(/raw\s*===\s*"([^"]+)"/g)].map((m) => m[1]);
  }

  /** The wire literals `toWireShelf` can RETURN — never its argument enum. */
  function toWireShelfResults(source: string): string[] {
    const body = /function toWireShelf\([\s\S]*?\n\}/.exec(source);
    if (!body) throw new Error("could not find `function toWireShelf` in source");
    // `shelf === "personal" ? "home" : "workspace"` — the two RESULT literals,
    // with the operator-vocabulary comparand dropped.
    return [...body[0].matchAll(/[?:]\s*"([^"]+)"/g)].map((m) => m[1]);
  }

  const sites: Array<[string, string[]]> = [
    [
      "src/features/agent-templates/types.ts › TemplateShelf",
      extractUnion(read("src/features/agent-templates/types.ts"), "TemplateShelf"),
    ],
    [
      "packages/dopl-client/src/knowledge-types.ts › KbShelf",
      extractUnion(read("packages/dopl-client/src/knowledge-types.ts"), "KbShelf"),
    ],
    [
      "packages/dopl-client/src/agent-template-types.ts › TemplateShelf",
      extractUnion(
        read("packages/dopl-client/src/agent-template-types.ts"),
        "TemplateShelf"
      ),
    ],
    [
      "packages/dopl-client/dist/knowledge-types.d.ts › KbShelf",
      extractUnion(read("packages/dopl-client/dist/knowledge-types.d.ts"), "KbShelf"),
    ],
    [
      "packages/dopl-client/dist/agent-template-types.d.ts › TemplateShelf",
      extractUnion(
        read("packages/dopl-client/dist/agent-template-types.d.ts"),
        "TemplateShelf"
      ),
    ],
    [
      "src/app/api/knowledge/bases/route.ts › readShelf",
      readShelfArms(read("src/app/api/knowledge/bases/route.ts")),
    ],
    [
      "src/app/api/agent-templates/route.ts › readShelf",
      readShelfArms(read("src/app/api/agent-templates/route.ts")),
    ],
    [
      "packages/mcp-server/src/tools/shelf.ts › toWireShelf",
      toWireShelfResults(read("packages/mcp-server/src/tools/shelf.ts")),
    ],
    [
      "packages/mcp-server/dist/tools/shelf.js › toWireShelf",
      toWireShelfResults(read("packages/mcp-server/dist/tools/shelf.js")),
    ],
  ];

  let drift = false;
  for (const [label, values] of sites) {
    const set = new Set(values);
    const missing = [...reference].filter((v) => !set.has(v));
    const extra = [...set].filter((v) => !reference.has(v));
    if (missing.length || extra.length) {
      drift = true;
      console.error(`[drift] ${label}:`);
      if (missing.length) console.error(`  missing shelf(s): ${missing.join(", ")}`);
      if (extra.length) console.error(`  extra shelf(s):   ${extra.join(", ")}`);
    }
  }

  // ⚠ THE DATABASE'S SIDE OF IT. Both features store the shelf as a BOOLEAN
  // `home_scoped` column, so the union is capped at two by the schema itself.
  // Read out of the migrations rather than asserted as a number here, so this
  // fails on the day the column stops being a boolean too.
  const migrations = resolve(__dirname, "..", "supabase", "migrations");
  const booleanColumns = readdirSync(migrations)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) =>
      /home_scoped\s+BOOLEAN\s+NOT\s+NULL/i.test(
        readFileSync(resolve(migrations, f), "utf8")
      )
    );
  if (booleanColumns.length !== 2) {
    drift = true;
    console.error(
      `[drift] expected 2 migrations declaring a \`home_scoped BOOLEAN NOT NULL\` column (knowledge + agent templates); found ${booleanColumns.length}: ${booleanColumns.join(", ") || "none"}`
    );
  } else if (reference.size !== 2) {
    drift = true;
    console.error(
      `[drift] the shelf union has ${reference.size} member(s) (${[...reference].join(", ")}) but both features store it as the BOOLEAN \`home_scoped\` (${booleanColumns.join(", ")}). A boolean encodes exactly two shelves — a third is a MIGRATION, not a type edit.`
    );
  }

  if (!drift) {
    console.log(
      `✅ All ${sites.length + 1} shelf declarations agree with ${REFERENCE_FILE} › KbShelf on the set: ${[...reference].sort().join(", ")}.`
    );
  }
  return drift;
}

function main(): void {
  const repoRoot = resolve(__dirname, "..");
  const serverSrc = readFileSync(
    resolve(repoRoot, "src/features/knowledge/types.ts"),
    "utf8"
  );
  const sdkSrc = readFileSync(
    resolve(repoRoot, "packages/dopl-client/src/knowledge-types.ts"),
    "utf8"
  );

  const server = extractInterfaces(serverSrc);
  const sdk = extractInterfaces(sdkSrc);

  let drift = false;
  for (const name of SHARED_INTERFACES) {
    const a = server.get(name);
    const b = sdk.get(name);
    if (!a) {
      console.error(`[drift] ${name} missing from src/features/knowledge/types.ts`);
      drift = true;
      continue;
    }
    if (!b) {
      console.error(
        `[drift] ${name} missing from packages/dopl-client/src/knowledge-types.ts`
      );
      drift = true;
      continue;
    }
    const aSet = new Set(a.fields);
    const bSet = new Set(b.fields);
    const onlyA = a.fields.filter((f) => !bSet.has(f));
    const onlyB = b.fields.filter((f) => !aSet.has(f));
    if (onlyA.length || onlyB.length) {
      console.error(`[drift] ${name} field name mismatch:`);
      if (onlyA.length) console.error(`  only in server types: ${onlyA.join(", ")}`);
      if (onlyB.length) console.error(`  only in SDK types:    ${onlyB.join(", ")}`);
      drift = true;
    }
  }

  if (drift) {
    console.error(
      "\n❌ Knowledge type drift detected. Sync src/features/knowledge/types.ts and packages/dopl-client/src/knowledge-types.ts."
    );
    process.exit(1);
  }
  console.log(
    `✅ All ${SHARED_INTERFACES.length} shared interfaces have matching field names.`
  );

  // The SECOND family this script guards — see `checkShelfUnions`.
  if (checkShelfUnions((rel) => readFileSync(resolve(repoRoot, rel), "utf8"))) {
    console.error(
      "\n❌ Shelf vocabulary drift detected. `KbShelf`/`TemplateShelf`, their committed dist/ mirrors, both `readShelf` guards and the MCP wire mapper are hand-mirrored: change every side in ONE change, rebuild with `npm run build -w @dopl/client && npm run build -w @dopl/mcp-server`, and remember a THIRD shelf needs a migration off the `home_scoped` boolean."
    );
    process.exit(1);
  }
}

main();
