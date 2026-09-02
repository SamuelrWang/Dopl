/**
 * THE MESSAGE-KIND SET, ACROSS THE THREE STATEMENTS NO COMPILER CAN REACH
 * (2026-09-02).
 *
 * `channel_messages.kind` is a closed set of six and `channel_messages.author_kind`
 * a closed set of three, and each is written down five times:
 *
 *   1. `src/features/channels/types.ts › ChannelMessageKind` / `MessageAuthorKind`
 *      — the REFERENCE. Where the set and every argument about it are stated.
 *   2. `src/features/channels/schema.ts › PostableMessageKindSchema` /
 *      `PostableAuthorKindSchema` — the zod half. **NOT READ BY THIS SCRIPT, ON
 *      PURPOSE:** since 2026-09-02 both are `closedEnum` over a type this file
 *      DERIVES from (1) with `Exclude`, so drift between (1) and (2) is a
 *      COMPILE ERROR in both directions (`shared/lib/closed-enum.ts`). Re-reading
 *      them here would be a second, weaker statement of a proof that already
 *      holds — which is the duplication this family of gates exists to delete.
 *   3. `packages/dopl-client/src/channel-types.ts` — the SDK mirror. The SDK
 *      cannot import `src/`, so it is a hand copy.
 *   4. `packages/dopl-client/dist/channel-types.d.ts` — the COMMITTED build,
 *      which is what `packages/mcp-server` and `main` actually import.
 *      `check-role-drift.ts` learned this one the hard way: a `src/`-only
 *      comparison stays green while the thing consumers read is stale.
 *   5. the column `CHECK` in `20260725120000_channels.sql`. SQL can import
 *      nothing, and it is the only one of the five that can REJECT a write.
 *
 * ⚠ **WHY A GATE AND NOT A COMMENT — THE TWO FAILURE DIRECTIONS ARE BOTH
 * SILENT, AND THEY ARE DIFFERENT BUGS.** A kind added to the TypeScript and not
 * to the `CHECK` compiles everywhere, passes every suite that mocks the
 * database, and then throws `23514` on a real INSERT — at the moment a session
 * reports what it did, which is the least recoverable moment there is. A kind
 * added to the `CHECK` and not to the union is worse and quieter: rows land that
 * `dto.ts › mapMessageRow` casts (`row.kind as ChannelMessageKind`) into a
 * member of a union that does not contain it, and every kind-keyed decision
 * downstream — `targeting.js › classify` returns `ignore` for anything but
 * `message`, the transcript's tag map, `await`'s activity filter — takes its
 * default branch on a value it has never heard of. Neither direction fails a
 * build or a test today.
 *
 * ⚠ **THE POSTABLE SUBSET IS DERIVED, AND THAT IS ASSERTED TOO.** `closedEnum`
 * proves the zod enums equal `PostableMessageKind` / `PostableAuthorKind`; it
 * cannot prove those types were not re-typed by hand as a literal union, and a
 * hand-typed copy would make the proof vacuous against the FULL set exactly when
 * the set grows. So the `Exclude<…>` spelling is pinned here, the way
 * `check-role-drift.ts` pins `isStandardWorkspace`'s positive form.
 *
 * ⚠ **NAMES AND PRESENCE ONLY**, like the sibling scripts. Order is not compared:
 * a union, a `.d.ts` and a SQL `IN` list are three vocabularies and only the SET
 * is the contract.
 *
 * ⚠ **THE MCP TOOL'S OWN `kind` ENUM IS DELIBERATELY NOT A SITE.**
 * `packages/mcp-server/src/tools/channel-schema.ts` publishes the five postable
 * kinds to an agent, and that surface is scheduled to lose the parameter
 * entirely (v2 §3 C21). A gate that read it would fail the change that deletes
 * it — a gate must not be the reason a deletion cannot land. It is fenced
 * instead by `channel-law.test.ts › REMOVED_VOCABULARY` and its own suite.
 *
 * Run: `npx tsx scripts/check-message-kind-drift.ts`
 * Wired: the `type-drift` job in `.github/workflows/ci.yml`.
 */
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
// The union reader is `check-role-drift.ts`'s, exported and already shared with
// `check-knowledge-type-drift.ts`. A second copy of that regex is precisely the
// class of duplication these scripts exist to catch.
import { extractUnion } from "./check-role-drift";

const REPO_ROOT = resolve(__dirname, "..");

/** Read a repo-relative file. Injectable so the gate's own test can mutate one. */
export type Read = (rel: string) => string;

const MIGRATIONS_DIR = "supabase/migrations";
/** The migration that CREATEs `channel_messages` — both `CHECK`s are inline in it. */
export const KIND_MIGRATION = `${MIGRATIONS_DIR}/20260725120000_channels.sql`;

export interface KindFamily {
  /** How a failure reads. */
  label: string;
  /** The `channel_messages` column whose `CHECK` states the set in SQL. */
  column: string;
  /** `src/features/channels/types.ts`'s union — the reference. */
  referenceType: string;
  /** The SDK's name for the same union (it does not share the server's). */
  sdkType: string;
  /** The type `Exclude`d from the reference, and what it excludes. */
  postable: { type: string; excluded: string[] };
}

const REFERENCE_FILE = "src/features/channels/types.ts";
const SDK_FILE = "packages/dopl-client/src/channel-types.ts";
const SDK_DIST_FILE = "packages/dopl-client/dist/channel-types.d.ts";

export const FAMILIES: KindFamily[] = [
  {
    label: "message kind",
    column: "kind",
    referenceType: "ChannelMessageKind",
    sdkType: "ChannelMessageKind",
    postable: { type: "PostableMessageKind", excluded: ["system"] },
  },
  {
    label: "author kind",
    column: "author_kind",
    referenceType: "MessageAuthorKind",
    sdkType: "ChannelAuthorKind",
    postable: { type: "PostableAuthorKind", excluded: ["system"] },
  },
];

/**
 * The literals of `CHECK (<column> IN ('a', 'b', …))`.
 *
 * ⚠ Anchored on the COLUMN NAME rather than on the first `CHECK` in the file:
 * `kind` is a suffix of `author_kind`, the two constraints are four lines apart,
 * and a lazy match would compare one column's set against the other's forever.
 */
export function sqlCheckValues(sql: string, column: string): string[] {
  const re = new RegExp(`CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, "i");
  const m = re.exec(sql);
  if (!m) {
    throw new Error(
      `could not find \`CHECK (${column} IN (…))\` in ${KIND_MIGRATION} — if the constraint moved to a later migration, point KIND_MIGRATION at that file, which is the one thing this script cannot infer`
    );
  }
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/**
 * ⚠ THE `CHECK` READ ABOVE IS ONLY THE TRUTH IF NOTHING RE-DEFINED IT LATER, and
 * a migration that did would make this whole gate compare against history —
 * green, and wrong, in the one direction nobody would think to check.
 *
 * ⚠ **THE PREDICATE NAMES `kind`, AND IT DID NOT UNTIL 2026-09-02.** It read
 * *"no later migration may carry a CONSTRAINT clause against `channel_messages`
 * at all"*, which was cheap and un-foolable right up to the first migration that
 * legitimately constrained a DIFFERENT column of this table —
 * `20260912120000_channel_delivery_verdict.sql`, whose CHECKs are on
 * `wake_verdict` and `delivery` and cannot redefine anything this gate reads. A
 * gate must not be the reason a change cannot land (the argument F-435 already
 * makes about this same file), and the alternative — an exemption list — records
 * a review that the regex can simply perform.
 *
 * ⚠ **IT IS STILL DELIBERATELY OVER-BROAD.** Any `CONSTRAINT` clause on this
 * table whose statement so much as mentions `kind` is reported, including
 * `author_kind`, including a DROP, and including a constraint merely NAMED for
 * one — a false positive costs one reader a minute, and a false negative makes
 * every set above compare against history.
 */
export function laterConstraintRedefinitions(
  read: Read,
  migrationFiles: string[]
): string[] {
  const base = KIND_MIGRATION.slice(MIGRATIONS_DIR.length + 1);
  return migrationFiles
    .filter((f) => f.endsWith(".sql") && f > base)
    .filter((f) =>
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?channel_messages[\s\S]{0,400}?CONSTRAINT[^;]{0,400}kind/i.test(
        read(`${MIGRATIONS_DIR}/${f}`)
      )
    );
}

/** Sites that state `family`'s set outside the compiler's reach, plus the reference. */
export function sitesFor(
  read: Read,
  family: KindFamily
): { reference: string[]; mirrors: Array<[string, string[]]> } {
  return {
    reference: extractUnion(read(REFERENCE_FILE), family.referenceType),
    mirrors: [
      [
        `${SDK_FILE} › ${family.sdkType}`,
        extractUnion(read(SDK_FILE), family.sdkType),
      ],
      [
        `${SDK_DIST_FILE} › ${family.sdkType}`,
        extractUnion(read(SDK_DIST_FILE), family.sdkType),
      ],
      [
        `${KIND_MIGRATION} › CHECK (${family.column} IN …)`,
        sqlCheckValues(read(KIND_MIGRATION), family.column),
      ],
    ],
  };
}

/**
 * Every drift line for one family — set disagreements first, then the derivation
 * of the postable subset. Empty means clean. Returned rather than printed so the
 * gate's own test can assert WHAT it caught, not merely that it exited.
 */
export function checkFamily(read: Read, family: KindFamily): string[] {
  const { reference, mirrors } = sitesFor(read, family);
  const expected = new Set(reference);
  const problems: string[] = [];

  for (const [label, values] of mirrors) {
    const set = new Set(values);
    const missing = [...expected].filter((k) => !set.has(k));
    const extra = [...set].filter((k) => !expected.has(k));
    if (missing.length) problems.push(`${label}: missing ${missing.join(", ")}`);
    if (extra.length) problems.push(`${label}: extra ${extra.join(", ")}`);
  }

  // The postable subset must be DERIVED from the reference, not re-typed.
  const { type, excluded } = family.postable;
  const derived = new RegExp(
    `type\\s+${type}\\s*=\\s*Exclude<\\s*${family.referenceType}\\s*,\\s*${excluded
      .map((e) => `"${e}"`)
      .join("\\s*\\|\\s*")}\\s*>`
  );
  if (!derived.test(read(REFERENCE_FILE))) {
    problems.push(
      `${REFERENCE_FILE} › ${type} is not \`Exclude<${family.referenceType}, ${excluded
        .map((e) => `"${e}"`)
        .join(" | ")}>\` — a hand-typed copy makes \`closedEnum\`'s proof vacuous against the full set exactly when the set grows`
    );
  }

  const unexcluded = excluded.filter((e) => !expected.has(e));
  if (unexcluded.length) {
    problems.push(
      `${REFERENCE_FILE} › ${type} excludes ${unexcluded.join(", ")}, which ${family.referenceType} no longer declares`
    );
  }

  return problems;
}

function main(): void {
  const read: Read = (rel) => readFileSync(resolve(REPO_ROOT, rel), "utf8");
  let drift = false;

  const redefined = laterConstraintRedefinitions(
    read,
    readdirSync(resolve(REPO_ROOT, MIGRATIONS_DIR))
  );
  if (redefined.length) {
    drift = true;
    console.error(
      `[drift] a later migration carries a CONSTRAINT clause against channel_messages: ${redefined.join(", ")}. This gate reads ${KIND_MIGRATION}; point KIND_MIGRATION at the newest definition, or it compares against history.`
    );
  }

  for (const family of FAMILIES) {
    const problems = checkFamily(read, family);
    if (problems.length) {
      drift = true;
      console.error(`[drift] ${family.label}:`);
      for (const p of problems) console.error(`  ${p}`);
    }
  }

  if (drift) {
    console.error(
      "\n❌ Message-kind drift detected. The set is stated in the server union, the SDK's type, the SDK's committed dist/ and the column CHECK, with no shared module between any two: change every side in ONE change, and rebuild with `npm run build -w @dopl/client`. A kind the database refuses throws 23514 on a real INSERT; a kind the database accepts and the union lacks takes the default branch of every kind-keyed decision downstream."
    );
    process.exit(1);
  }

  for (const family of FAMILIES) {
    const { reference } = sitesFor(read, family);
    console.log(
      `✅ ${family.label}: 4 declarations agree on the set (${reference.slice().sort().join(", ")}); ${family.postable.type} is derived.`
    );
  }
}

// Guarded like `check-role-drift.ts`: `message-kind-drift.test.ts` imports the
// helpers above, and an unguarded call would run the gate as a side effect of
// that import.
if (require.main === module) main();
