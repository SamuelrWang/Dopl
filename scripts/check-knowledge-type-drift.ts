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
 * ⚠ **THREE CLASSES SINCE 2026-09-02 (slice B15), DOWN FROM FIVE.** The MCP
 * MAPPER (`tools/shelf.ts › toWireShelf`, class 4) and the DATABASE's
 * `home_scoped BOOLEAN` (class 5) are both DELETED: the MCP surface no longer
 * takes a `shelf` argument at all, and the shelf is a TENANCY — the caller's
 * `kind='personal'` container — rather than a boolean beside one. **The union is
 * therefore no longer capped at two by the schema**, so the cap assertion went
 * with the column; what is left is the same hand-mirroring problem in the same
 * silent direction.
 *
 * THREE CLASSES, and the last is not an `export type` declaration at all:
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

  // 🔒 ⚠ **THE COLUMN IS GONE AND SO IS ITS CAP (2026-09-02, slice B15).** This
  // block read the migrations for `home_scoped BOOLEAN NOT NULL` and refused a
  // union of more than two on the grounds that a boolean encodes exactly two
  // shelves. `20260923120000_drop_home_scoped.sql` drops it: a shelf is a
  // CONTAINER now, so a third value is a code change and not a migration, and
  // the assertion would have gone on passing while describing nothing. What
  // replaces it is the assertion below — the column must not come BACK.
  const migrations = resolve(__dirname, "..", "supabase", "migrations");
  const drop = readdirSync(migrations).some(
    (f) =>
      f.endsWith("_drop_home_scoped.sql") &&
      /DROP\s+COLUMN\s+IF\s+EXISTS\s+home_scoped/i.test(
        readFileSync(resolve(migrations, f), "utf8")
      )
  );
  if (!drop) {
    drift = true;
    console.error(
      `[drift] no migration drops \`home_scoped\`. The shelf is a TENANCY (the caller's kind='personal' container) and nothing may re-introduce the boolean beside it — a column and a container answering the same question is how a row comes to be on one shelf and listed on the other.`
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
      "\n❌ Shelf vocabulary drift detected. `KbShelf`/`TemplateShelf`, their committed dist/ mirrors and both `readShelf` guards are hand-mirrored: change every side in ONE change and rebuild with `npm run build -w @dopl/client`."
    );
    process.exit(1);
  }
}

main();
