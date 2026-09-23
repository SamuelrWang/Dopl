/**
 * Two hand-mirror families in one CI step:
 *  1. the field NAMES of the shared knowledge interfaces, `src/features/knowledge/types.ts` vs
 *     `packages/dopl-client/src/knowledge-types.ts` (types and order may differ);
 *  2. the shelf vocabulary (`checkShelfUnions`).
 * Run: `npx tsx scripts/check-knowledge-type-drift.ts`
 */
import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";
// `check-role-drift.ts`'s `main()` is guarded on `require.main`, so this imports only the helper.
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
  // `export interface Name { ... }` up to the first unindented `}`: flat shapes only.
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
 * The shelf vocabulary, declared in several places with nothing else between them. Drift here
 * widens silently: every site answers an unrecognised shelf with the WIDER list. Checked against
 * `KbShelf`: the `IdentityShelf`/`KbShelf` unions in `src/` and the SDK, their committed `dist/`
 * copies (what main and the MCP server import), and each route's `readShelf` guard.
 */
function checkShelfUnions(read: (rel: string) => string): boolean {
  const REFERENCE_FILE = "src/features/knowledge/types.ts";
  const reference = new Set(extractUnion(read(REFERENCE_FILE), "KbShelf"));
  // An empty reference would make every site agree with it: a broken parser, not a clean bill.
  if (reference.size === 0) throw new Error(`${REFERENCE_FILE} › KbShelf parsed to no literals`);

  /** The wire literals a `readShelf` guard admits — its `raw === "…"` arms. */
  function readShelfArms(source: string): string[] {
    const body = /function readShelf\([\s\S]*?\n\}/.exec(source);
    if (!body) throw new Error("could not find `function readShelf` in source");
    return [...body[0].matchAll(/raw\s*===\s*"([^"]+)"/g)].map((m) => m[1]);
  }

  const sites: Array<[string, string[]]> = [
    [
      "src/features/agent-identities/types.ts › IdentityShelf",
      extractUnion(read("src/features/agent-identities/types.ts"), "IdentityShelf"),
    ],
    [
      "packages/dopl-client/src/knowledge-types.ts › KbShelf",
      extractUnion(read("packages/dopl-client/src/knowledge-types.ts"), "KbShelf"),
    ],
    [
      "packages/dopl-client/src/agent-identity-types.ts › IdentityShelf",
      extractUnion(
        read("packages/dopl-client/src/agent-identity-types.ts"),
        "IdentityShelf"
      ),
    ],
    [
      "packages/dopl-client/dist/knowledge-types.d.ts › KbShelf",
      extractUnion(read("packages/dopl-client/dist/knowledge-types.d.ts"), "KbShelf"),
    ],
    [
      "packages/dopl-client/dist/agent-identity-types.d.ts › IdentityShelf",
      extractUnion(
        read("packages/dopl-client/dist/agent-identity-types.d.ts"),
        "IdentityShelf"
      ),
    ],
    [
      "src/app/api/knowledge/bases/route.ts › readShelf",
      readShelfArms(read("src/app/api/knowledge/bases/route.ts")),
    ],
    [
      "src/app/api/agent-identities/route.ts › readShelf",
      readShelfArms(read("src/app/api/agent-identities/route.ts")),
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

  // The shelf is a tenancy (the personal container); the `home_scoped` boolean must not come back.
  // Both directories: `drop_home_scoped` may still be held in `supabase/migrations-held/`.
  const migrationDirs = [
    resolve(__dirname, "..", "supabase", "migrations"),
    resolve(__dirname, "..", "supabase", "migrations-held"),
  ].filter((d) => existsSync(d));
  const drop = migrationDirs.some((dir) =>
    readdirSync(dir).some(
      (f) =>
        f.endsWith("_drop_home_scoped.sql") &&
        /DROP\s+COLUMN\s+IF\s+EXISTS\s+home_scoped/i.test(
          readFileSync(resolve(dir, f), "utf8")
        )
    )
  );
  if (!drop) {
    drift = true;
    console.error(
      `[drift] no migration (applied or held) drops \`home_scoped\`. The shelf is a TENANCY (the caller's kind='personal' container) and nothing may re-introduce the boolean beside it — a column and a container answering the same question is how a row comes to be on one shelf and listed on the other.`
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
    if (a.fields.length === 0 || b.fields.length === 0) {
      console.error(`[drift] ${name} parsed to zero fields — the extractor no longer reads it`);
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

  if (checkShelfUnions((rel) => readFileSync(resolve(repoRoot, rel), "utf8"))) {
    console.error(
      "\n❌ Shelf vocabulary drift detected. `KbShelf`/`IdentityShelf`, their committed dist/ mirrors and both `readShelf` guards are hand-mirrored: change every side in ONE change and rebuild with `npm run build -w @dopl/client`."
    );
    process.exit(1);
  }
}

main();
