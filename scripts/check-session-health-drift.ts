/**
 * THE SESSION-HEALTH FIELD SET, ACROSS ITS FOUR HAND-MIRRORS (2026-09-02).
 *
 * `ChannelSessionHealth` is the seven operator-only facts a session row carries
 * about whether an agent is GETTING ANYWHERE (T50 / T51 / T83, migration
 * `20260909120000_channel_sessions_health.sql`). It is declared FOUR times with
 * nothing between any two of them:
 *
 *   1. `src/features/channels/types-sessions.ts › ChannelSessionHealth`  — the
 *      REFERENCE. Where the shape and every argument about it are stated.
 *   2. `src/features/channels/schema-sessions.ts › SessionStateEntrySchema` —
 *      the zod half. A field the server does not accept is a field the desktop
 *      reports into a strip.
 *   3. `packages/dopl-client/src/session-health-types.ts › ChannelSessionHealth`
 *      — the SDK mirror. Its own docblock says it is a hand mirror "WITH NO
 *      DRIFT GATE OVER IT". This is that gate.
 *   4. `packages/dopl-client/dist/session-health-types.d.ts` — the COMMITTED
 *      build, which is what `packages/mcp-server` actually imports.
 *      `check-role-drift.ts` learned this lesson first: a `src/`-only comparison
 *      is green while the thing consumers read is stale.
 *
 * ⚠ **WHY IT NEEDS A GATE AND WHY THE FAILURE IS SILENT.** Every field is
 * `optional` AND `nullable` — deliberately, because an older desktop must not
 * 400 its whole push (INVARIANTS §11, §13). That is exactly what makes drift
 * invisible: a field added on one side and not another COMPILES on both, passes
 * every test, and simply never arrives. There is no type error and no runtime
 * error; the render just shows one fewer fact, forever.
 *
 * ⚠ **NAMES AND PRESENCE ONLY**, like the sibling scripts: the four sites use
 * four different vocabularies for the same fact (a TS optional, a zod chain, a
 * `.d.ts` and — in the migration — a snake_case column), so comparing types would
 * compare spellings rather than the contract.
 *
 * ⚠ **THE COLUMN SET IS THE FIFTH SITE AND IS COMPARED TOO.** A field with no
 * column is a field zod accepts and the upsert drops; a column with no field is
 * one nothing can ever write. Read out of the migration rather than typed here.
 *
 * Run: `npx tsx scripts/check-session-health-drift.ts`
 * Wired: the `type-drift` job in `.github/workflows/ci.yml`.
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const REPO_ROOT = resolve(__dirname, "..");
const read = (rel: string): string =>
  readFileSync(resolve(REPO_ROOT, rel), "utf8");

const REFERENCE_FILE = "src/features/channels/types-sessions.ts";

/** camelCase field → its `snake_case` column. ⚠ Stated, never derived: the two
 *  vocabularies are the server's and the database's and a regex that guessed
 *  would silently agree with a column that does not exist. */
const COLUMN_FOR: Record<string, string> = {
  turns: "turns",
  tokensDelta: "tokens_delta",
  stale: "stale",
  deniedCalls: "denied_calls",
  lastDeniedTool: "last_denied_tool",
  lastWakeSeq: "last_wake_seq",
  lastWakeAt: "last_wake_at",
};

const MIGRATION = "supabase/migrations/20260909120000_channel_sessions_health.sql";

/**
 * The field names in a declaration of `<name>`, whichever of the three forms it
 * takes — ⚠ and it must take all three, because the four sites do not agree on
 * one: `types-sessions.ts` writes `export type X = { … }`, the SDK writes
 * `export interface X { … }`, and the emitted `.d.ts` may write either with a
 * `declare` in front. A reader that insisted on one spelling would report a
 * missing declaration as a crash rather than as drift.
 * ⚠ Comment and blank lines dropped, so a field named only in prose is not
 * counted — the same reader `check-knowledge-type-drift.ts` uses.
 */
function typeFields(source: string, name: string): string[] {
  const re = new RegExp(
    `(?:export\\s+)?(?:declare\\s+)?(?:interface\\s+${name}\\s*|type\\s+${name}\\s*=\\s*)\\{([\\s\\S]*?)\\n\\}`
  );
  const m = re.exec(source);
  if (!m) {
    throw new Error(
      `could not find a declaration of \`${name}\` — if it was renamed, rename it in every one of the four sites this script names, which is the point of the script`
    );
  }
  return fieldNamesIn(m[1]);
}

function fieldNamesIn(body: string): string[] {
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !l.startsWith("//") &&
        !l.startsWith("/*") &&
        !l.startsWith("*")
    )
    .map((l) => {
      const cleaned = l.replace(/\/\/.*$/, "").trim().replace(/;$/, "");
      const m = cleaned.match(/^(\w+)\??\s*:/);
      return m ? m[1] : null;
    })
    .filter((f): f is string => f !== null);
}

/**
 * The health keys `SessionStateEntrySchema` accepts.
 *
 * ⚠ **SCOPED TO THE HEALTH BLOCK BY ITS OWN SENTINEL COMMENT**, not to the whole
 * object: that schema also carries the identity and cost halves, and comparing
 * the whole thing would report every one of those as "extra" forever.
 */
const HEALTH_BLOCK_START = "// ── HEALTH (2026-09-01, migration 20260909120000)";
/** ⚠ The NEXT sentinel, not the end of the object: `displayName` follows the
 *  health block inside the same schema, and a reader that ran to `});` would
 *  report it as an extra health field forever. */
const HEALTH_BLOCK_END = "// ── THE OPERATOR-GIVEN AGENT NAME";

function zodHealthFields(source: string): string[] {
  const start = source.indexOf(HEALTH_BLOCK_START);
  if (start === -1) {
    throw new Error(
      "could not find the HEALTH sentinel comment in schema-sessions.ts — if the block moved, move this reader with it rather than widening it to the whole schema"
    );
  }
  const rest = source.slice(start + HEALTH_BLOCK_START.length);
  const end = rest.indexOf(HEALTH_BLOCK_END);
  if (end === -1) {
    throw new Error(
      `could not find the sentinel that ENDS the health block ("${HEALTH_BLOCK_END}") — without it this reader would swallow every field declared after it`
    );
  }
  const block = rest.slice(0, end);
  // ⚠ `z\b` RATHER THAN `z\.`: a field whose chain is long enough to wrap opens
  // `field: z` and continues on the next line, which a `z\.` reader would miss —
  // and MISSING a field here reports it as drift on every OTHER site at once.
  return [...block.matchAll(/^\s{2}(\w+):\s*(?:z\b|safeLabel)/gm)].map((m) => m[1]);
}

/** Columns the migration ADDs to `channel_sessions`. */
function migrationColumns(source: string): string[] {
  return [...source.matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)/g)].map((m) => m[1]);
}

function main(): void {
  const reference = typeFields(read(REFERENCE_FILE), "ChannelSessionHealth");
  const expected = new Set(reference);

  const knownColumns = Object.keys(COLUMN_FOR);
  const unmapped = reference.filter((f) => !COLUMN_FOR[f]);
  const orphanMappings = knownColumns.filter((f) => !expected.has(f));

  const sites: Array<[string, string[]]> = [
    [
      "src/features/channels/schema-sessions.ts › SessionStateEntrySchema (health block)",
      zodHealthFields(read("src/features/channels/schema-sessions.ts")),
    ],
    [
      "packages/dopl-client/src/session-health-types.ts › ChannelSessionHealth",
      typeFields(
        read("packages/dopl-client/src/session-health-types.ts"),
        "ChannelSessionHealth"
      ),
    ],
    [
      "packages/dopl-client/dist/session-health-types.d.ts › ChannelSessionHealth",
      typeFields(
        read("packages/dopl-client/dist/session-health-types.d.ts"),
        "ChannelSessionHealth"
      ),
    ],
    [
      `${MIGRATION} (ADD COLUMN)`,
      migrationColumns(read(MIGRATION))
        // The migration's columns are snake_case; compare in the reference's
        // vocabulary so a mismatch reads as a FIELD name, which is what a fix
        // edits. A column with no mapping stays as itself and reports as extra.
        .map((c) => knownColumns.find((f) => COLUMN_FOR[f] === c) ?? c),
    ],
  ];

  let drift = false;

  if (unmapped.length) {
    drift = true;
    console.error(
      `[drift] ${REFERENCE_FILE} declares field(s) this script has no column mapping for: ${unmapped.join(", ")}. Add them to COLUMN_FOR — a new health field is a MIGRATION, not a type edit.`
    );
  }
  if (orphanMappings.length) {
    drift = true;
    console.error(
      `[drift] COLUMN_FOR maps field(s) the reference no longer declares: ${orphanMappings.join(", ")}.`
    );
  }

  for (const [label, values] of sites) {
    const set = new Set(values);
    const missing = [...expected].filter((f) => !set.has(f));
    const extra = [...set].filter((f) => !expected.has(f));
    if (missing.length || extra.length) {
      drift = true;
      console.error(`[drift] ${label}:`);
      if (missing.length) console.error(`  missing field(s): ${missing.join(", ")}`);
      if (extra.length) console.error(`  extra field(s):   ${extra.join(", ")}`);
    }
  }

  if (drift) {
    console.error(
      `\n❌ Session-health drift detected. Every field is optional AND nullable, so drift here does not fail a build or a test — it just means the field never arrives. Sync all four declarations and the migration in ONE change.`
    );
    process.exit(1);
  }

  console.log(
    `✅ All ${sites.length} session-health declarations agree with ${REFERENCE_FILE} › ChannelSessionHealth on the set: ${reference.slice().sort().join(", ")}.`
  );
}

if (require.main === module) main();
