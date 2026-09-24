// The migration directory as ONE string, FORWARD-RENAMED — the desktop suites' copy of
// `src/shared/supabase/migration-renames.ts`, which they cannot import (TypeScript, `@/` paths).
//
// Each file is rewritten with every table/index rename a LATER file performs, so a replay sees
// each object under its final name: a publication ADD, a REPLICA IDENTITY and a CREATE UNIQUE
// INDEX written before `ALTER TABLE x RENAME TO y` all read as `y`. Comments are NOT stripped —
// both callers regex the raw text, which is why a migration states its rollback as prose.
// ⚠ A rename is a whole-word substitution, the TypeScript module's rule.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RENAME_RES = [
  /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s+RENAME\s+TO\s+"?([a-z0-9_]+)"?/gi,
  /ALTER\s+INDEX\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s+RENAME\s+TO\s+"?([a-z0-9_]+)"?/gi,
];

/** Every migration's raw SQL, filename-sorted (= apply order), forward-renamed, joined. */
export function readForwardRenamedMigrations(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => readFileSync(join(dir, f), "utf8"));
  const renames = [];
  files.forEach((sql, i) => {
    for (const re of RENAME_RES) {
      for (const m of sql.matchAll(re)) {
        if (m[1] !== m[2]) renames.push({ file: i, at: m.index, from: m[1], to: m[2] });
      }
    }
  });
  renames.sort((a, b) => a.file - b.file || a.at - b.at);
  return files.map((sql, i) => {
    let out = sql;
    for (const r of renames) {
      if (r.file <= i) continue;
      out = out.replace(new RegExp(`\\b${r.from}\\b`, "g"), r.to);
    }
    return out;
  }).join("\n");
}
