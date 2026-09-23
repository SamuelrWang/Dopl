/**
 * Rename-aware migration replay for the text-scanning gates (`rls-policy-scan.ts`,
 * `scripts/check-rls-pair-gate.ts`, `scripts/check-tenancy-move-gate.ts`, the `schema-sql` suites).
 * Forward-renaming: each file is rewritten with every rename a LATER file performs, so the replay
 * sees each object under its final name and the rename itself is a no-op.
 * Understands `ALTER TABLE … RENAME TO / RENAME COLUMN / RENAME CONSTRAINT`, `ALTER INDEX … RENAME
 * TO` and `ALTER TRIGGER … RENAME TO`. ⚠ A rename is a whole-word substitution applied to every
 * table that spells the name, so a non-uniform column rename must be declared here before relying
 * on this. Reads comment-stripped SQL.
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
