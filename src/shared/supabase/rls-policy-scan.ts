import { readMigrations, statementAt } from "./migration-files";

/**
 * The migration replay as a scanner, shared by the RLS redteam suites: replays
 * `supabase/migrations/*.sql` in apply order and answers with the FINAL policy and function bodies.
 * ⚠ A structural assertion, not a behavioural one (F-523): only a suite's live half proves Postgres
 * agrees. A later `DROP POLICY` matters as much as the `CREATE`, hence replay, not the newest file.
 */

const FILES = readMigrations();

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

const CREATE_POLICY =
  /CREATE\s+POLICY\s+"?([a-z0-9_]+)"?\s+ON\s+(?:public\.)?"?([a-z0-9_]+)"?/gi;
const DROP_POLICY =
  /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"?([a-z0-9_]+)"?\s+ON\s+(?:public\.)?"?([a-z0-9_]+)"?/gi;
const DROP_TABLE =
  /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi;

/**
 * Policy bodies alive after the replay, keyed `<table>.<policy>`. Events within one file apply in
 * text order, so `DROP …; CREATE …` is a replacement. ⚠ A `DROP TABLE` silently takes its
 * policies with it (F-586).
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

const RLS_TOGGLE =
  /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s+(ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY/gi;

/** Tables whose last `… ROW LEVEL SECURITY` statement is `ENABLE`; a `DROP TABLE` clears it. */
export function liveRlsEnabled(): Set<string> {
  const enabled = new Set<string>();
  for (const file of FILES) {
    const events: Array<{ at: number; run: () => void }> = [];
    for (const m of file.sql.matchAll(RLS_TOGGLE)) {
      const [, table, verb] = m;
      events.push({
        at: m.index,
        run: () => (verb.toUpperCase() === "ENABLE" ? enabled.add(table) : enabled.delete(table)),
      });
    }
    for (const m of file.sql.matchAll(DROP_TABLE)) {
      const table = m[1];
      events.push({ at: m.index, run: () => enabled.delete(table) });
    }
    for (const e of events.sort((a, b) => a.at - b.at)) e.run();
  }
  return enabled;
}

/**
 * The last `CREATE OR REPLACE FUNCTION <name>` body. Not `statementAt`: the `$tag$` body's own
 * semicolons sit at paren depth 0.
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
