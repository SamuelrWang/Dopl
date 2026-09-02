/**
 * THE MESSAGE-KIND SET, ACROSS THE ONE STATEMENT NO COMPILER CAN REACH
 * (2026-09-02).
 *
 * `channel_messages.kind` is a closed set of six and `channel_messages.author_kind`
 * a closed set of three, and each is written down three times:
 *
 *   1. `packages/contracts/src/channels.ts › ChannelMessageKind` /
 *      `MessageAuthorKind` — the REFERENCE. Where the set and every argument
 *      about it are stated, and since 2026-09-02 the ONLY TypeScript declaration
 *      of either: `src/features/channels/types.ts` and the SDK's
 *      `channel-types.ts` both RE-EXPORT it (v2 slice A13).
 *   2. `src/features/channels/schema.ts › PostableMessageKindSchema` /
 *      `PostableAuthorKindSchema` — the zod half. **NOT READ BY THIS SCRIPT, ON
 *      PURPOSE:** both are `closedEnum` over a type this file DERIVES from (1)
 *      with `Exclude`, so drift between (1) and (2) is a COMPILE ERROR in both
 *      directions (`shared/lib/closed-enum.ts`). Re-reading them here would be a
 *      second, weaker statement of a proof that already holds — which is the
 *      duplication this family of gates exists to delete.
 *   3. the column `CHECK` in `20260725120000_channels.sql`. SQL can import
 *      nothing, and it is the only one of the three that can REJECT a write.
 *
 * ⚠ **TWO SITES LEFT THIS SCRIPT ON 2026-09-02 AND THEY ARE NOT "NO LONGER
 * CHECKED".** `packages/dopl-client/src/channel-types.ts` and its committed
 * `dist/channel-types.d.ts` were sites (3) and (4) here because the SDK could not
 * import `src/`. It now imports `@dopl/contracts`, so both emit a RE-EXPORT and
 * there is no literal union left in either to disagree — the compiler holds that
 * pair, strictly harder than this regex did. Do not re-add them: `extractUnion`
 * would throw on a re-export, which is a gate that fails on the correct state.
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
  /** `@dopl/contracts`' union — the reference. */
  referenceType: string;
  /** The type `Exclude`d from the reference, and what it excludes. */
  postable: { type: string; excluded: string[] };
}

const REFERENCE_FILE = "packages/contracts/src/channels.ts";

export const FAMILIES: KindFamily[] = [
  {
    label: "message kind",
    column: "kind",
    referenceType: "ChannelMessageKind",
    postable: { type: "PostableMessageKind", excluded: ["system"] },
  },
  {
    label: "author kind",
    column: "author_kind",
    referenceType: "MessageAuthorKind",
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
      "\n❌ Message-kind drift detected. The set is stated in `@dopl/contracts` and in the column CHECK, and no TypeScript reaches a CHECK: change both sides in ONE change. A kind the database refuses throws 23514 on a real INSERT; a kind the database accepts and the union lacks takes the default branch of every kind-keyed decision downstream."
    );
    process.exit(1);
  }

  for (const family of FAMILIES) {
    const { reference } = sitesFor(read, family);
    console.log(
      `✅ ${family.label}: the contracts union and the column CHECK agree on the set (${reference.slice().sort().join(", ")}); ${family.postable.type} is derived.`
    );
  }
}

// Guarded like `check-role-drift.ts`: `message-kind-drift.test.ts` imports the
// helpers above, and an unguarded call would run the gate as a side effect of
// that import.
if (require.main === module) main();
