import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  FAMILIES,
  KIND_MIGRATION,
  checkFamily,
  laterConstraintRedefinitions,
  sqlCheckValues,
  type Read,
} from "../../../scripts/check-message-kind-drift";

/**
 * THE GATE, MUTATION-VERIFIED — and it is the gate's only test, deliberately.
 *
 * ⚠ **A DRIFT GATE THAT CANNOT FAIL IS WORSE THAN NO GATE**, because it is read
 * as evidence. Every sibling of `scripts/check-message-kind-drift.ts` ships
 * untested and each has already had a pass-by-accident: `check-role-drift.ts`
 * read only `src/` while the `dist/` mirrors it named were the ones drifting,
 * and the description ratchet in `tool-budget.test.ts` was asserting NOTHING in
 * its downward half until 2026-09-02. So this file does not check that the gate
 * passes today (the CI step does that, on the real tree). It MUTATES a site and
 * asserts the gate CATCHES it — once per site, because a reader that silently
 * matches nothing reports every OTHER site as drifted and looks like a real
 * failure somewhere else entirely.
 *
 * ⚠ It lives here, next to the sets it guards, because the root vitest project
 * is `src/**` only; the script is imported by relative path and its `main()` is
 * `require.main`-guarded, so importing it runs the helpers and not the gate.
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const realRead: Read = (rel) => readFileSync(resolve(REPO_ROOT, rel), "utf8");

/** `realRead`, with one file's text rewritten. The mutation surface. */
const readWith = (rel: string, mutate: (src: string) => string): Read => {
  const patched = mutate(realRead(rel));
  return (r) => (r === rel ? patched : realRead(r));
};

const REFERENCE_FILE = "src/features/channels/types.ts";
const SDK_FILE = "packages/dopl-client/src/channel-types.ts";
const SDK_DIST_FILE = "packages/dopl-client/dist/channel-types.d.ts";

const messageKind = FAMILIES.find((f) => f.label === "message kind")!;
const authorKind = FAMILIES.find((f) => f.label === "author kind")!;

describe("check-message-kind-drift catches drift at every site it names", () => {
  it("is clean on the tree as it stands", () => {
    for (const family of FAMILIES) expect(checkFamily(realRead, family)).toEqual([]);
  });

  it("catches a kind the SERVER union gained and nothing else did", () => {
    // The direction that throws 23514 on a real INSERT.
    const read = readWith(REFERENCE_FILE, (s) =>
      s.replace(
        `export type ChannelMessageKind =\n  | "message"`,
        `export type ChannelMessageKind =\n  | "decision"\n  | "message"`
      )
    );
    const problems = checkFamily(read, messageKind);
    expect(problems).toHaveLength(3);
    for (const site of [SDK_FILE, SDK_DIST_FILE, KIND_MIGRATION]) {
      expect(problems.some((p) => p.startsWith(site))).toBe(true);
    }
    expect(problems.every((p) => p.includes("missing decision"))).toBe(true);
  });

  it("catches a kind the COLUMN CHECK gained and the union did not", () => {
    // The quieter direction: rows land that every kind-keyed decision defaults on.
    const read = readWith(KIND_MIGRATION, (s) =>
      s.replace("CHECK (kind IN ('message'", "CHECK (kind IN ('decision', 'message'")
    );
    expect(checkFamily(read, messageKind)).toEqual([
      `${KIND_MIGRATION} › CHECK (kind IN …): extra decision`,
    ]);
  });

  it("catches a STALE committed dist/, not only a stale SDK source", () => {
    // `check-role-drift.ts`'s original hole: the mirror consumers actually import.
    const read = readWith(SDK_DIST_FILE, (s) =>
      s.replace(' | "task_failed" | "system"', ' | "system"')
    );
    expect(checkFamily(read, messageKind)).toEqual([
      `${SDK_DIST_FILE} › ChannelMessageKind: missing task_failed`,
    ]);
  });

  it("catches the AUTHOR-kind family separately from the message one", () => {
    // Two constraints four lines apart, one name a suffix of the other: a reader
    // anchored on the first `CHECK` in the file would compare the wrong column.
    const read = readWith(SDK_FILE, (s) =>
      s.replace(
        'export type ChannelAuthorKind = "user" | "agent" | "system";',
        'export type ChannelAuthorKind = "user" | "agent";'
      )
    );
    expect(checkFamily(read, authorKind)).toEqual([
      `${SDK_FILE} › ChannelAuthorKind: missing system`,
    ]);
    expect(checkFamily(read, messageKind)).toEqual([]);
  });

  it("reads each column's OWN check, `kind` not being `author_kind`'s suffix", () => {
    const sql = realRead(KIND_MIGRATION);
    expect(sqlCheckValues(sql, "kind")).toContain("task_progress");
    expect(sqlCheckValues(sql, "author_kind")).toEqual(["user", "agent", "system"]);
  });

  it("catches a postable subset that was RE-TYPED instead of derived", () => {
    // `closedEnum` still proves the zod enum equals this type — against a list
    // that no longer follows the full set. The proof survives; its meaning does not.
    const read = readWith(REFERENCE_FILE, (s) =>
      s.replace(
        'export type PostableMessageKind = Exclude<ChannelMessageKind, "system">;',
        'export type PostableMessageKind =\n  | "message"\n  | "task_started"\n  | "task_progress"\n  | "task_finished"\n  | "task_failed";'
      )
    );
    const problems = checkFamily(read, messageKind);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("PostableMessageKind is not `Exclude<");
  });

  it("catches an excluded kind the reference union no longer declares", () => {
    // Dropping `system` from the union leaves the `Exclude` spelling valid and
    // pointing at a member that is gone — the derivation still COMPILES, and
    // says nothing. Every mirror reports it as extra as well, which is right:
    // the database would still accept a kind the union no longer has.
    const read = readWith(REFERENCE_FILE, (s) =>
      s.replace('  | "task_failed"\n  | "system";', '  | "task_failed";')
    );
    const problems = checkFamily(read, messageKind);
    expect(problems).toContain(
      `${REFERENCE_FILE} › PostableMessageKind excludes system, which ChannelMessageKind no longer declares`
    );
    expect(problems.filter((p) => p.endsWith("extra system"))).toHaveLength(3);
  });

  it("refuses to read a CHECK that a later migration may have replaced", () => {
    const later = "20269999120000_channel_messages_kind_widen.sql";
    const read: Read = (rel) =>
      rel === `supabase/migrations/${later}`
        ? "ALTER TABLE public.channel_messages\n  DROP CONSTRAINT channel_messages_kind_check;"
        : realRead(rel);
    expect(laterConstraintRedefinitions(read, [later])).toEqual([later]);
    // The base migration is never its own redefinition, and neither is an
    // earlier file — this list is filename-ordered, like the replay (§12).
    expect(
      laterConstraintRedefinitions(realRead, [
        "20260725120000_channels.sql",
        "20260101000000_before.sql",
      ])
    ).toEqual([]);
  });
});
