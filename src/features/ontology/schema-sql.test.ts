/**
 * Invariant suite for the ontology share schema, read out of `supabase/migrations`
 * and replayed in apply order (slice S1, `docs/specs/home-ontology.md` §3.1/§3.4).
 * These are database facts no application test can reach: every ontology read runs
 * on the service-role client and never meets a policy or a trigger.
 *
 * It pins the final state AFTER replay, not one file — a `DROP` in a later
 * migration is as load-bearing as the `CREATE`. Files are read in filename order,
 * which is apply order.
 *
 * Comments are stripped line-wise before matching (the shared replay module's
 * rule), so the two header assertions below read the files raw — the only thing
 * in here that may.
 *
 * Mutation-verified 2026-09-09, 8 reverts / 8 failures. The two that survived the
 * first round both failed for one reason: an assertion not scoped to its own table
 * or column, so it matched another table's identical line. Hence
 * {@link SHARE_TABLE} and the per-column loop below.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FILES,
  livePolicies,
  liveFunctionHeader,
  tableIsLive,
} from "@/features/knowledge/migration-replay";

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "supabase",
  "migrations"
);

const SHARES = "20261001120000_ontology_home_shares.sql";
const READABLE = "20261001130000_ontology_readable.sql";

/** Every migration's stripped SQL, concatenated in apply order. */
const REPLAYED = FILES.map((f) => f.sql).join("\n");
const raw = (name: string) => readFileSync(join(MIGRATIONS, name), "utf8");

/**
 * The `CREATE TABLE ontology_channel_shares (…)` body alone. The narrowing is the
 * point: the same column line asserted against the whole replay is satisfied by
 * `channel_members` and a dozen other tables, so flipping this column to
 * `SET NULL` stayed green (caught 2026-09-09).
 */
const SHARE_TABLE = (() => {
  const at = REPLAYED.search(
    /CREATE TABLE (?:IF NOT EXISTS )?public\.ontology_channel_shares \(/i
  );
  return at === -1 ? "" : REPLAYED.slice(at, REPLAYED.indexOf("\n);", at));
})();

describe("the two S1 files exist, sort correctly, and are HELD", () => {
  it("both are in `supabase/migrations/`, exactly once, in the stated order", () => {
    const names = FILES.map((f) => f.name);
    expect(names.filter((n) => n === SHARES)).toHaveLength(1);
    expect(names.filter((n) => n === READABLE)).toHaveLength(1);
    // §3.4's order, and the dependency: the functions read the table.
    expect(names.indexOf(SHARES)).toBeLessThan(names.indexOf(READABLE));
  });

  it("🔒 both sort AFTER `agent_template_knowledge_scopes` — the stated apply order", () => {
    // The version stamp is not the applied version (F-304's re-stamp): apply
    // by NAME. What filename order buys is the REPLAY order, which is what every
    // scan in this repo — and `supabase db reset` — actually uses.
    const names = FILES.map((f) => f.name);
    const prior = "20260930150000_agent_template_knowledge_scopes.sql";
    expect(names).toContain(prior);
    expect(names.indexOf(prior)).toBeLessThan(names.indexOf(SHARES));
  });

  it("🔒 no other file reuses either VERSION stamp", () => {
    // `schema_migrations` is keyed by version and can hold only one.
    for (const file of [SHARES, READABLE]) {
      const version = file.split("_")[0];
      expect(
        FILES.filter((f) => f.name.startsWith(`${version}_`)).map((f) => f.name)
      ).toEqual([file]);
    }
  });

  it("🔒 each header says WRITTEN, NOT APPLIED — this directory's standing gate", () => {
    for (const file of [SHARES, READABLE]) {
      expect(raw(file), file).toMatch(/WRITTEN, NOT APPLIED/i);
      expect(raw(file), file).toMatch(/APPLY (IT )?BY NAME/i);
      expect(raw(file), file).toMatch(/ROLLBACK/);
    }
  });
});

describe("ontology_channel_shares — the row", () => {
  it("is live after the replay", () => {
    expect(tableIsLive("ontology_channel_shares")).toBe(true);
  });

  it("🔒 is keyed `(ontology_id, channel_id)` — spec I5, the SAME ontology in two channels", () => {
    expect(SHARE_TABLE).toMatch(/PRIMARY KEY \(ontology_id, channel_id\)/i);
  });

  it.each([
    ["ontology_id", "ontologies"],
    ["channel_id", "channels"],
    ["workspace_id", "workspaces"],
  ])("🔒 %s CASCADEs to %s — Q4, both delete directions", (column, parent) => {
    // A `SET NULL` on any of them leaves a live share row pointing at nothing,
    // and the delete confirm that names the channel count would lie.
    expect(SHARE_TABLE).toMatch(
      new RegExp(
        String.raw`${column}\s+UUID NOT NULL REFERENCES public\.${parent}\(id\)\s+ON DELETE CASCADE`,
        "i"
      )
    );
  });

  it("🔒 the LADDER's three rungs, on EACH of the three audience columns", () => {
    // `edit ⇒ view` (spec I2) needs no separate CHECK. Asserted per column:
    // "the word `edit` appears somewhere in the constraint" is satisfied by the
    // other two columns while this one silently loses its top rung.
    const at = SHARE_TABLE.search(/CONSTRAINT ontology_share_levels_check\b/i);
    expect(at).toBeGreaterThan(-1);
    const check = SHARE_TABLE.slice(at);
    for (const column of ["members_level", "guests_level", "owner_agents_level"]) {
      expect(check, column).toMatch(
        new RegExp(String.raw`${column}\s+IN \('none', 'view', 'edit'\)`, "i")
      );
    }
  });

  it("🔒 the DEFAULTS are Samuel's Q2 answer", () => {
    // Members `view`; guests `none` (a guest is not a member by default); the
    // owner's agents `view`.
    expect(REPLAYED).toMatch(/members_level\s+TEXT NOT NULL DEFAULT 'view'/i);
    expect(REPLAYED).toMatch(/guests_level\s+TEXT NOT NULL DEFAULT 'none'/i);
    expect(REPLAYED).toMatch(/owner_agents_level TEXT NOT NULL DEFAULT 'view'/i);
  });

  it("🔒 both indexes exist, and there is no third", () => {
    // Each has a named statement behind it — `20260805120000`'s rule.
    const indexes = [
      ...REPLAYED.matchAll(
        /CREATE INDEX (?:IF NOT EXISTS )?(\w+)\s+ON public\.ontology_channel_shares/gi
      ),
    ].map((m) => m[1]);
    expect(indexes.sort()).toEqual([
      "ontology_channel_shares_channel_idx",
      "ontology_channel_shares_workspace_idx",
    ]);
  });
});

describe("the scope trigger — both arms refusable AT REST", () => {
  const body = () => liveFunctionHeader("assert_ontology_share_scope") ?? "";

  it("is SECURITY DEFINER with a pinned search_path", () => {
    expect(body()).toMatch(/SECURITY DEFINER/i);
    expect(body()).toMatch(/SET search_path = public, pg_temp/i);
  });

  it("🔒 arm 1 — `workspace_id` is the ONTOLOGY's container, not the channel's", () => {
    // `20260914120000` rule 3. A wrong container files the share where the
    // owner's personal-container cascade cannot reach it.
    expect(REPLAYED).toMatch(
      /NEW\.workspace_id <> v_owner_workspace[\s\S]{0,200}RAISE EXCEPTION/i
    );
  });

  it("🔒 arm 2 — Q5, home channels only, in the POSITIVE form", () => {
    // `<> 'link'`, never `= 'standard'`: asking the negative would silently admit
    // every kind added to the union later, `personal` included (INVARIANTS §4A,
    // F-295).
    expect(REPLAYED).toMatch(/v_channel_kind <> 'link'/i);
    expect(REPLAYED).toMatch(/home channels only/i);
    expect(body()).not.toMatch(/'standard'/);
  });

  it("🔒 it is wired BEFORE INSERT **OR UPDATE** — a level edit re-checks the scope", () => {
    expect(REPLAYED).toMatch(
      /CREATE TRIGGER ontology_channel_shares_assert_scope\s+BEFORE INSERT OR UPDATE ON public\.ontology_channel_shares/i
    );
  });
});

describe("the two columns on the ontology tables", () => {
  it("🔒 `agents_may_edit` defaults TRUE — the toggle only ever narrows", () => {
    expect(REPLAYED).toMatch(
      /ADD COLUMN IF NOT EXISTS agents_may_edit BOOLEAN NOT NULL DEFAULT true/i
    );
  });

  it("🔒 `last_edited_source` is the SAME two-word vocabulary knowledge and skills use", () => {
    // A third word here would be a third answer to one question (Q6). Naming
    // which agent is deferred: a template id on an ontology row is a second
    // identity model.
    for (const table of ["ontologies", "ontology_objects"]) {
      expect(REPLAYED, table).toMatch(
        new RegExp(
          String.raw`ADD CONSTRAINT ${table}_last_edited_source_check\s+CHECK \(last_edited_source IN \('user', 'agent'\)\)`,
          "i"
        )
      );
      expect(REPLAYED, table).toMatch(
        new RegExp(
          String.raw`ALTER TABLE public\.${table}\s+ADD COLUMN IF NOT EXISTS last_edited_by UUID REFERENCES auth\.users\(id\) ON DELETE SET NULL`,
          "i"
        )
      );
    }
  });

  it("🔒 `DEFAULT` IS the backfill — no UPDATE statement on either table", () => {
    // The defaults satisfy every existing row the moment the columns exist; a
    // backfill UPDATE would rewrite every ontology row.
    expect(raw(SHARES)).not.toMatch(/^\s*UPDATE\s+public\.ontology_/im);
  });
});

describe("the predicates — SECURITY DEFINER, pinned, and caller-subject-free", () => {
  const FUNCTIONS = [
    "dopl_ontology_share_level",
    "dopl_ontology_object_ontologies",
    "dopl_ontology_readable",
    "dopl_ontology_writable",
  ] as const;

  it.each(FUNCTIONS)("%s is SECURITY DEFINER with a pinned search_path", (fn) => {
    const header = liveFunctionHeader(fn) ?? "";
    expect(header, fn).toMatch(/SECURITY DEFINER/i);
    expect(header, fn).toMatch(/SET search_path = public, pg_temp/i);
    expect(header, fn).toMatch(/\bSTABLE\b/i);
  });

  it("🔒 the rank is IMMUTABLE — the CHECK and the comparison cannot disagree", () => {
    expect(liveFunctionHeader("dopl_ontology_level_rank") ?? "").toMatch(
      /\bIMMUTABLE\b/i
    );
  });

  it("🔒 NONE takes a caller-supplied SUBJECT, which is why `authenticated` may EXECUTE", () => {
    // A function here that ever grows a caller-supplied subject must lose the
    // `authenticated` grant in the same change.
    for (const fn of [...FUNCTIONS, "dopl_ontology_level_rank"]) {
      expect(liveFunctionHeader(fn) ?? "", fn).not.toMatch(/p_user_id/i);
    }
  });

  it.each([...FUNCTIONS, "dopl_ontology_level_rank"])(
    "%s revokes PUBLIC + anon and grants authenticated + service_role",
    (fn) => {
      const args = fn === "dopl_ontology_level_rank" ? "text" : "uuid";
      expect(REPLAYED, fn).toMatch(
        new RegExp(
          String.raw`REVOKE ALL ON FUNCTION public\.${fn}\(${args}\)\s+FROM PUBLIC, anon;`,
          "i"
        )
      );
      expect(REPLAYED, fn).toMatch(
        new RegExp(
          String.raw`GRANT EXECUTE ON FUNCTION public\.${fn}\(${args}\)\s+TO authenticated, service_role;`,
          "i"
        )
      );
    }
  );
});

describe("the share table's privileges and its ONE policy", () => {
  it("🔒 RLS is enabled and writes are REVOKED, not policed", () => {
    expect(REPLAYED).toMatch(
      /ALTER TABLE public\.ontology_channel_shares ENABLE ROW LEVEL SECURITY/i
    );
    expect(REPLAYED).toMatch(
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES\s+ON public\.ontology_channel_shares FROM anon, authenticated/i
    );
  });

  it("🔒 exactly one policy, and it is FOR SELECT", () => {
    const own = livePolicies("ontology_channel_shares");
    expect([...own.keys()]).toEqual(["ontology_channel_shares_member_select"]);
    expect(own.get("ontology_channel_shares_member_select")).toMatch(
      /\bFOR\s+SELECT\b/i
    );
  });
});

describe("NOT a realtime change, and both files say so", () => {
  it("🔒 the share table joins NO publication — a share row is settings", () => {
    expect(REPLAYED).not.toMatch(
      /ALTER PUBLICATION supabase_realtime ADD TABLE public\.ontology_channel_shares/i
    );
  });

  it("🔒 neither file touches the four ontology tables' replica identity", () => {
    for (const file of [SHARES, READABLE]) {
      const sql = FILES.find((f) => f.name === file)?.sql ?? "";
      // The DDL, not the word: both files name `REPLICA IDENTITY USING INDEX`
      // inside the `RAISE EXCEPTION` that asserts it survived.
      expect(sql, file).not.toMatch(/ALTER TABLE[^;]*REPLICA IDENTITY/i);
      expect(sql, file).not.toMatch(/ALTER PUBLICATION/i);
    }
  });

  it("🔒 each file re-ASSERTS what it did not touch, rather than trusting it", () => {
    for (const file of [SHARES, READABLE]) {
      const sql = FILES.find((f) => f.name === file)?.sql ?? "";
      expect(sql, file).toMatch(/pg_publication_tables/i);
      expect(sql, file).toMatch(/relreplident/i);
      expect(sql, file).toMatch(/RAISE EXCEPTION/i);
    }
  });
});
