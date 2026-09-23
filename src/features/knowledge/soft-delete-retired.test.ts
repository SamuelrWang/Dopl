/**
 * INVARIANT SUITE — knowledge soft-delete is RETIRED IN THE DATABASE, and a
 * base delete takes its whole subtree with it (Samuel's ruling, 2026-09-18:
 * *"When a user deletes a KB, it's just gone. There's no soft deletion."*).
 *
 * The sibling `server/service-delete.test.ts` pins the SERVICE half — that every
 * delete calls a `hardDelete*` repo function and never stamps `deleted_at`. It
 * cannot see one layer down, because its repository is mocked. This file is that
 * layer: the migration directory REPLAYED IN FILENAME ORDER (= apply order), and
 * the two database facts no application test can reach.
 *
 *   1. **The soft-delete machinery is gone after replay** —
 *      `20261013120000_drop_knowledge_soft_delete.sql`. Two of the six functions
 *      (`cascade_*_soft_delete_to_attachments`) were LIVE DEFECTS, not merely
 *      dead: their bodies `DELETE FROM workflow_knowledge_bases` /
 *      `workflow_skills`, tables `20260811120000_drop_workflows_and_clusters.sql`
 *      dropped. That file's own header explains the miss — *"DROP TABLE removes
 *      the tables' own triggers"* — and these two triggers sit on
 *      `knowledge_bases` and `skills`, which survived.
 *
 *   2. **Every child of a base cascades** — so `hardDeleteBase`'s single
 *      `DELETE` cannot leave entries, folders, chunks, stars or identity
 *      attachments behind. Asserted as a PROPERTY over every FK in the tree, not
 *      as a list: a table added tomorrow with a nullable or RESTRICT reference
 *      turns this red without anyone remembering to extend it.
 *
 * ⚠ **`revisions` IS DELIBERATELY ABSENT FROM (2), AND THAT IS NOT AN OVERSIGHT.**
 * `revisions.resource_id` has no FK and no cascade ON PURPOSE:
 * `server/service-base-writes.ts › deleteBase` files an `op='delete'` revision
 * IMMEDIATELY AFTER the hard delete, so a cascade would erase the row the delete
 * path had just written. `20261002120000_revisions.sql` states the trade in its
 * own header. An append-only audit log surviving its subject is the feature, and
 * a test that "fixed" it would be pinning a regression.
 *
 * Comments are stripped line-wise by `migration-replay.ts` before matching,
 * because these migration headers quote their own SQL at length — the header of
 * the very file this suite is about quotes every statement it drops.
 */

import { describe, it, expect } from "vitest";
import { FILES, liveFunctionBody, tableIsLive } from "./migration-replay";

/**
 * The six functions `20261013120000` retires. Two shapes, one ruling:
 * the `cascade_*_to_attachments` pair are trigger functions that called dropped
 * tables; the four `cascade_{soft_delete,restore}_{base,folder}` are the
 * trash-and-restore RPCs themselves — every one of them exists only to STAMP or
 * CLEAR `deleted_at`.
 */
const RETIRED_FUNCTIONS = [
  "cascade_kb_soft_delete_to_attachments",
  "cascade_skill_soft_delete_to_attachments",
  "cascade_soft_delete_base",
  "cascade_soft_delete_folder",
  "cascade_restore_base",
  "cascade_restore_folder",
] as const;

/** Their triggers, and the surviving table each one hung off. */
const RETIRED_TRIGGERS = [
  ["kb_soft_delete_cascade_attachments", "knowledge_bases"],
  ["skill_soft_delete_cascade_attachments", "skills"],
] as const;

/**
 * Replay `CREATE TRIGGER` / `DROP TRIGGER` for one name in apply order and
 * answer whether it is live at the end. Not in `migration-replay.ts` because no
 * other suite asks about triggers; lift it there the moment a second one does.
 *
 * ⚠ The `DROP` arm must be honoured or every "is it gone" assertion here is
 * green by construction — F-661's lesson, taken from the function replayer that
 * had exactly this bug.
 */
function triggerIsLive(name: string): boolean {
  let live = false;
  const create = new RegExp(String.raw`CREATE\s+TRIGGER\s+${name}\b`, "gi");
  const drop = new RegExp(
    String.raw`DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?${name}\b`,
    "gi"
  );
  for (const { sql } of FILES) {
    // Order matters WITHIN a file too: `20260502110000` drops and re-creates
    // both of these names in one file.
    const events: Array<{ at: number; alive: boolean }> = [];
    for (const m of sql.matchAll(create)) {
      if (m.index !== undefined) events.push({ at: m.index, alive: true });
    }
    for (const m of sql.matchAll(drop)) {
      if (m.index !== undefined) events.push({ at: m.index, alive: false });
    }
    events.sort((a, b) => a.at - b.at);
    for (const e of events) live = e.alive;
  }
  return live;
}

describe("knowledge soft-delete — retired by the replayed migration set", () => {
  it("the replay reads the directory at all (an empty scan must not pass silently)", () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES.map((f) => f.name)).toContain(
      "20261013120000_drop_knowledge_soft_delete.sql"
    );
  });

  it.each(RETIRED_FUNCTIONS)("%s is gone after replay", (name) => {
    expect(liveFunctionBody(name)).toBeNull();
  });

  it.each(RETIRED_TRIGGERS)("trigger %s on %s is gone after replay", (name) => {
    expect(triggerIsLive(name)).toBe(false);
  });

  /**
   * 🔒 THE GUARD AGAINST A VACUOUS SUITE. Every assertion above is satisfied by
   * a typo in a function name, and would also be satisfied by a migration that
   * dropped the LIVE delete path. `cascade_hard_delete_folder`
   * (`20260807140000`) is what `repository-folders.ts › hardDeleteFolder`
   * actually calls, and it must survive the same replay.
   */
  it("the live hard-delete RPC survives — this suite is not passing by deleting everything", () => {
    expect(liveFunctionBody("cascade_hard_delete_folder")).not.toBeNull();
    expect(tableIsLive("knowledge_bases")).toBe(true);
    expect(tableIsLive("skills")).toBe(true);
  });

  /**
   * The defect the drop closes, stated as the fact that made it one: the two
   * trigger bodies wrote tables the replay no longer creates. Without this, a
   * reader cannot tell "retired because dead" from "retired because broken".
   */
  it.each(["workflow_knowledge_bases", "workflow_skills"])(
    "%s does not exist after replay — what the dropped trigger bodies wrote to",
    (table) => {
      expect(tableIsLive(table)).toBe(false);
    }
  );
});

describe("a base delete leaves no child rows", () => {
  /**
   * Every `REFERENCES … knowledge_bases(id)` in the whole replayed directory,
   * with the 80 characters from the match — comfortably past the longest
   * spelling (`REFERENCES public.knowledge_bases(id) ON DELETE CASCADE`, 55),
   * and an `ON DELETE …` clause must sit immediately after the reference.
   *
   * A PROPERTY, NOT A LIST: `hardDeleteBase` is one `DELETE FROM
   * knowledge_bases`, so a child whose FK does not cascade is a row that
   * OUTLIVES its base (or, with the default `NO ACTION`, a delete that fails
   * outright). Either way it is this ruling broken, and a hard-coded list of
   * today's five children would not notice tomorrow's sixth.
   */
  const references = FILES.flatMap(({ name, sql }) =>
    [...sql.matchAll(/REFERENCES\s+(?:public\.)?knowledge_bases\s*\(\s*id\s*\)/gi)].map(
      (m) => ({
        file: name,
        // The whole clause the parser would see, normalised to one line so the
        // failure message is readable.
        clause: sql
          .slice(m.index ?? 0, (m.index ?? 0) + 80)
          .replace(/\s+/g, " "),
      })
    )
  );

  it("finds the foreign keys at all (an empty scan must not pass silently)", () => {
    expect(references.length).toBeGreaterThanOrEqual(5);
  });

  it("🔒 every foreign key to knowledge_bases is ON DELETE CASCADE", () => {
    const offenders = references.filter(
      (r) => !/ON DELETE CASCADE/i.test(r.clause)
    );
    expect(offenders).toEqual([]);
  });
});
