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
 */
import { readFileSync } from "fs";
import { resolve } from "path";

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
}

main();
