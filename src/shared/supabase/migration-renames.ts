/**
 * RENAME-AWARE MIGRATION REPLAY — the one place the text-scanning gates learn that an object
 * they are looking for was `ALTER … RENAME`d rather than dropped and re-created.
 *
 * ⚠ WHY IT EXISTS (2026-09-22, the agent-template → agent-identity rename). Every replay in this
 * repo — `knowledge/migration-replay.ts`, `shared/supabase/rls-policy-scan.ts`,
 * `scripts/check-rls-pair-gate.ts`, `scripts/check-tenancy-move-gate.ts`, the per-feature
 * `schema-sql` suites — answers "what is live at the end" by regexing `CREATE TABLE` / `ADD
 * CONSTRAINT` / `CREATE POLICY` under a NAME. A rename keeps the object and changes the name, so
 * without this every one of them reports the renamed table as never created and the old one as
 * still standing.
 *
 * THE MODEL: FORWARD-RENAMING. Each file's text is rewritten with every rename that a LATER file
 * performs, in apply order — so the file that CREATED `agent_templates` reads, to the replay, as
 * having created `agent_identities`, and the rename statement itself becomes a no-op. Everything
 * downstream (policies, constraints, columns, `REFERENCES`) then replays exactly as if the object
 * had always carried the name it carries at the end. That is the question every one of these
 * gates asks, so it is the right fiction.
 *
 * ⚠ WHAT IT UNDERSTANDS, and nothing else: `ALTER TABLE … RENAME TO`, `… RENAME COLUMN a TO b`,
 * `… RENAME CONSTRAINT a TO b`, `ALTER INDEX … RENAME TO`, `ALTER TRIGGER a ON t RENAME TO b`.
 * A rename is applied as a WHOLE-WORD textual substitution, so a column rename lands on every
 * table that spells that column — correct for every rename this directory holds today
 * (`template_id` / `template_name` were renamed on every table that had them), and the reason a
 * future column rename that is NOT uniform must say so here before it relies on this.
 * ⚠ It reads COMMENT-STRIPPED SQL: callers pass what their own scan reads.
 */

export interface MigrationText {
  name: string;
  sql: string;
}

interface Rename {
  file: number;
  from: string;
  to: string;
}

const RENAME_RES: RegExp[] = [
  /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s+RENAME\s+TO\s+"?([a-z0-9_]+)"?/gi,
  /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?[a-z0-9_]+"?\s+RENAME\s+(?:COLUMN|CONSTRAINT)\s+"?([a-z0-9_]+)"?\s+TO\s+"?([a-z0-9_]+)"?/gi,
  /ALTER\s+INDEX\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s+RENAME\s+TO\s+"?([a-z0-9_]+)"?/gi,
  /ALTER\s+TRIGGER\s+"?([a-z0-9_]+)"?\s+ON\s+(?:public\.)?"?[a-z0-9_]+"?\s+RENAME\s+TO\s+"?([a-z0-9_]+)"?/gi,
];

function renamesIn(sql: string, file: number): Array<Rename & { at: number }> {
  const out: Array<Rename & { at: number }> = [];
  for (const re of RENAME_RES) {
    for (const m of sql.matchAll(re)) {
      if (m.index !== undefined && m[1] !== m[2]) out.push({ file, from: m[1], to: m[2], at: m.index });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Every file rewritten with the renames LATER files perform, applied in apply order. */
export function forwardRenamed<T extends MigrationText>(files: readonly T[]): T[] {
  const renames: Rename[] = files.flatMap((f, i) => renamesIn(f.sql, i));
  if (renames.length === 0) return [...files];
  return files.map((f, i) => {
    let sql = f.sql;
    for (const r of renames) {
      if (r.file <= i) continue;
      sql = sql.replace(new RegExp(String.raw`\b${r.from}\b`, "g"), r.to);
    }
    return sql === f.sql ? f : { ...f, sql };
  });
}
