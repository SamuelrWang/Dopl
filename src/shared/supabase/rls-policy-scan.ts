import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * THE MIGRATION REPLAY, AS A SCANNER — the shared half of every RLS redteam
 * suite (Wave B B7's `knowledge/server/rls-redteam.test.ts`, B12's three more).
 *
 * 🔒 WHY A SCANNER AT ALL. These are DATABASE facts no application test can
 * reach while every repository reads as the service role, and the tree has no
 * database: Docker is down, so `supabase start` cannot run and Wave A's and
 * Wave B's migrations are all unapplied. The SQL half of each suite therefore
 * replays `supabase/migrations/*.sql` in filename order — which IS apply order
 * — and asserts on the FINAL policy and function bodies. `knowledge/
 * schema-sql.test.ts` and `channels/schema-sql.test.ts` use the same technique
 * for the same reason.
 *
 * ⚠ A STRUCTURAL ASSERTION IS NOT A BEHAVIOURAL ONE (F-523). This proves a rule
 * is WRITTEN once and names every arm; only the LIVE half of a suite proves
 * Postgres agrees. Say it that way in any doc that cites one.
 *
 * ⚠ REPLAY, NOT "THE NEWEST FILE". A `DROP POLICY` in a later migration is as
 * load-bearing as the `CREATE` — a scan that read only the newest file would
 * pass while a wider policy sat underneath it, which is precisely the
 * `chats_member_select` history (`20260716150000` → `20260720211005` →
 * `20260916120000` → `20260921120000`).
 *
 * ⚠ COMMENTS ARE STRIPPED LINE-WISE before matching, because these migrations'
 * headers QUOTE the policy bodies they replace and a scan that did not strip
 * them would pin a paragraph. Take the hand scanner from
 * `channels/schema-sql.test.ts` if a migration touching these tables ever puts a
 * `--` inside a string literal.
 */

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "supabase",
  "migrations"
);

function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const at = line.indexOf("--");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

/** Every migration, filename-sorted (= apply order), comments removed. */
const FILES = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((name) => ({
    name,
    sql: stripLineComments(readFileSync(join(MIGRATIONS, name), "utf8")),
  }));

/** The statement starting at `from`, up to the first `;` at paren depth 0. */
function statementAt(sql: string, from: number): string {
  let depth = 0;
  for (let i = from; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") depth--;
    else if (sql[i] === ";" && depth === 0) return sql.slice(from, i + 1);
  }
  return sql.slice(from);
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

const CREATE_POLICY =
  /CREATE\s+POLICY\s+"?([a-z0-9_]+)"?\s+ON\s+(?:public\.)?"?([a-z0-9_]+)"?/gi;
const DROP_POLICY =
  /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"?([a-z0-9_]+)"?\s+ON\s+(?:public\.)?"?([a-z0-9_]+)"?/gi;
const DROP_TABLE =
  /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi;

/**
 * The policy bodies alive after the replay, keyed `<table>.<policy>`.
 * ⚠ Events inside ONE file are applied in TEXT ORDER, so the `DROP … ; CREATE …`
 * idiom this repo uses for a policy edit lands as a replacement rather than as a
 * deletion.
 *
 * 🔒 **A `DROP TABLE` TAKES ITS POLICIES WITH IT, SILENTLY, AND THIS SCANNER DID
 * NOT KNOW THAT UNTIL 2026-09-02 (F-586).** A policy is a dependency of its
 * table; Postgres removes it without a `DROP POLICY` line for anyone to replay.
 * So `skill_files`, dropped CASCADE in July 2026, went on answering as a fenced
 * table to every reader of this function — four redteam suites, the pair gate
 * and two findings — and phase 2 wrote it a NEW policy that would have aborted
 * the apply with `relation "skill_files" does not exist`. **A scanner that
 * cannot tell a fence from an epitaph is worse than no scanner: it reports the
 * dead one as armed.**
 */
export function livePolicies(): Map<string, string> {
  const live = new Map<string, string>();
  for (const file of FILES) {
    const events: Array<{ at: number; run: () => void }> = [];
    for (const m of file.sql.matchAll(CREATE_POLICY)) {
      const key = `${m[2]}.${m[1]}`;
      const body = squash(statementAt(file.sql, m.index));
      events.push({ at: m.index, run: () => live.set(key, body) });
    }
    for (const m of file.sql.matchAll(DROP_POLICY)) {
      const key = `${m[2]}.${m[1]}`;
      events.push({ at: m.index, run: () => live.delete(key) });
    }
    for (const m of file.sql.matchAll(DROP_TABLE)) {
      const prefix = `${m[1]}.`;
      events.push({
        at: m.index,
        run: () => {
          for (const key of [...live.keys()]) if (key.startsWith(prefix)) live.delete(key);
        },
      });
    }
    for (const e of events.sort((a, b) => a.at - b.at)) e.run();
  }
  return live;
}

/**
 * The LAST `CREATE OR REPLACE FUNCTION <name>` body across the replay.
 * ⚠ Not `statementAt`: a function body is a `$tag$ … $tag$` literal whose own
 * semicolons sit at paren depth 0, so the whole dollar-quoted body is taken.
 */
export function liveFunction(name: string): string {
  let found: string | null = null;
  for (const file of FILES) {
    for (const m of file.sql.matchAll(
      new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`, "gi")
    )) {
      const rest = file.sql.slice(m.index);
      const open = rest.match(/\$([a-z_]*)\$/i);
      if (!open) continue;
      const tag = open[0];
      const start = rest.indexOf(tag);
      const end = rest.indexOf(tag, start + tag.length);
      found = squash(rest.slice(0, end + tag.length));
    }
  }
  if (found === null) throw new Error(`no live definition of ${name}`);
  return found;
}
