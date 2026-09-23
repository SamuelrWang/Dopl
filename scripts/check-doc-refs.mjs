#!/usr/bin/env node
//
// check-doc-refs.mjs — the lint for the docs' rottable reference classes (`docs/*.md`,
// non-recursive: subfolders are frozen snapshots). No dependencies; exit 1 lists every miss.
//
//   (a) FILE REFS `path/file.ext:NNN` — the file exists (the line number is never checked).
//   (b) F-IDS in docs — resolve to a live `### F-NNN` heading in REFACTOR-FINDINGS.md or to a
//       mention in its header block (above the first `##`), where deleted entries are recorded.
//       Ranges (`F-001–F-015`, `F-179 through F-187`) expand.
//   (c) SYMBOL ANCHORS `path › symbol` — the file exists AND the symbol's name appears in it as
//       plain text (`normalizeSymbol` cuts signatures/values). Containment, not parsing: it
//       catches the symbol that exists nowhere, not one that exists only in a comment.
//   (d) F-IDS IN SOURCE (`src/`, `packages/`, `apps/`, `dopl-desktop-app/`, `scripts/`,
//       `supabase/`; `dist/` skipped) — same rule as (b). Catches a dangling id, never a mis-cited
//       live one.
//   (e) PLAIN PATHS — an inline code span whose ENTIRE content is a path (anchored `^…$`; prose
//       and fenced blocks are never scanned). A RATCHET: paths already dead when this class landed
//       live in `scripts/doc-refs-plain-path-baseline.json` and report as BASELINED debt; anything
//       else fails. The baseline only shrinks — stale entries print (never fail), and there is no
//       flag to regenerate it.
// Basenames resolve against any path suffix (weak but real: fires when a file is deleted or
// renamed). TS aliases (`@/`, `#/`) are un-aliased first. `DATED_CAPTURES` and
// `KNOWN_DEAD_REFS` exempt snapshot docs and deliberate dead citations.
//
// Usage: `node scripts/check-doc-refs.mjs`

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const FINDINGS_REL = 'docs/REFACTOR-FINDINGS.md';
const PLAIN_PATH_BASELINE_REL = 'scripts/doc-refs-plain-path-baseline.json';

/**
 * Class (e)'s baseline. Keys are `<docRelPath>::<span as written>` (before dealiasing, no line
 * number). A missing or unreadable baseline is a HARD ERROR, never an empty set.
 */
function loadPlainPathBaseline() {
  const abs = path.join(REPO_ROOT, PLAIN_PATH_BASELINE_REL);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    console.error(
      `check-doc-refs: cannot read ${PLAIN_PATH_BASELINE_REL} (${err.message}).\n` +
        `  Class (e) needs it to tell PRE-EXISTING dead paths from NEW ones. Restore the file from\n` +
        `  git rather than regenerating it — a regenerated baseline silently absorbs whatever rot\n` +
        `  landed since it was measured, which is the one thing it exists to prevent.`,
    );
    process.exit(2);
  }
  if (!Array.isArray(parsed?.entries)) {
    console.error(`check-doc-refs: ${PLAIN_PATH_BASELINE_REL} has no "entries" array.`);
    process.exit(2);
  }
  return { measuredAt: parsed.measuredAt ?? 'unknown', keys: new Set(parsed.entries) };
}

// `dist/` is not skipped here: findings cite the committed build output on purpose.
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.claude', 'out', 'coverage', '.turbo', '.vercel']);

// Docs that state their own capture date and describe the tree as it was then: a dead ref in a
// snapshot is the record. Never add a live doc here — fix its reference.
const DATED_CAPTURES = new Map([
  ['docs/AUDIT-FIX-VERIFICATION.md', 'captured 2026-05-04'],
  ['docs/CHANNELS-AUDIT-2026-08-07.md', 'audited 2026-08-07'],
  ['docs/DRIFT-LEDGER-2026-08-30.md', 'measured 2026-08-30 @ 6b3b1ead'],
  ['docs/CLEANUP.md', 'generated + executed 2026-06-12'],
  ['docs/DATA-LOADING-AUDIT.md', 'audited 2026-06-20'],
  ['docs/M5-M6-M10-AUDIT-FINDINGS.md', 'captured 2026-05-04'],
  ['docs/M7-M11-AUDIT-FINDINGS.md', 'captured 2026-05-04'],
  ['docs/MCP-MULTI-WORKSPACE.md', 'captured 2026-05-03'],
  ['docs/NEXT-SESSION-FIXES.md', 'handoff 2026-08-01, ⛔ superseded 2026-08-05'],
]);

// Per-reference exemptions for a live doc naming a deliberately deleted file. This list shrinks.
const KNOWN_DEAD_REFS = new Set([
  'docs/LAUNCH-READINESS-ROADMAP.md::trash/server/service.ts:178',
  'docs/LAUNCH-READINESS-ROADMAP.md::skills-trash-modal.tsx:174',
]);

// `md` included: a doc citing a doc rots like one citing code.
const SOURCE_EXT = 'ts|tsx|mts|cts|js|jsx|mjs|cjs|sql|md';

// Class (d)'s roots (`docs/` is classes (a)–(c)'s).
const SOURCE_ID_ROOTS = ['src', 'packages', 'apps', 'dopl-desktop-app', 'scripts', 'supabase'];
const SOURCE_ID_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|sql)$/;
// Generated output repeats its source's ids, so class (d) alone skips `dist/`.
const SOURCE_ID_SKIP = new Set([...SKIP_DIRS, 'dist']);

// The lookbehind keeps `index.d.ts:69` whole and lets a ref start right after a `/`.
const FILE_REF_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9_.-])([A-Za-z0-9_@][A-Za-z0-9_.@/-]*\.(?:${SOURCE_EXT})):(\d+)(?:-(\d+))?`,
  'g',
);

const F_ID_RE = /\bF-(\d{1,4})\b/g;

// `path.ext › symbol`: the symbol half runs to the end of the code span (or line) and
// `normalizeSymbol` cuts it to the name. `›` is U+203A.
const SYMBOL_ANCHOR_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9_.-])([A-Za-z0-9_@][A-Za-z0-9_.@/-]*\.(?:${SOURCE_EXT}))\s*›\s*([^\n\`]+)`,
  'g',
);

// Class (e): every single-backtick span; a claim only if the WHOLE span is a path. Fences toggle.
const CODE_SPAN_RE = /`([^`\n]+)`/g;
const WHOLE_SPAN_PATH_RE = new RegExp(
  String.raw`^[A-Za-z0-9_@#][A-Za-z0-9_.@#/-]*\.(?:${SOURCE_EXT})$`,
);
const FENCE_RE = /^\s{0,3}(?:```|~~~)/;

// TS path aliases (root `tsconfig.json` `@/`, `apps/desktop-ui/tsconfig.json` `#/`). A new alias
// belongs here or class (e) reports its files missing.
const PATH_ALIASES = [
  ['@/', 'src/'],
  ['#/', 'apps/desktop-ui/src/'],
];

/** The repo-relative form of a code-span path, un-aliasing an import specifier. */
function dealias(ref) {
  for (const [prefix, real] of PATH_ALIASES) {
    if (ref.startsWith(prefix)) return real + ref.slice(prefix.length);
  }
  return ref;
}

/**
 * The anchor's NAME, or `null`: markdown emphasis stripped, then the first quoted string or bare
 * identifier (`member.method` keeps `member`). `_` is not emphasis here — code spans keep
 * SCREAMING_SNAKE names whole.
 */
function normalizeSymbol(raw) {
  const text = raw.replace(/[*`]/g, '').trim();
  const quoted = text.match(/^["'“”‘’]([^"'“”‘’]+)["'“”‘’]/);
  if (quoted) return quoted[1].trim() || null;
  const ident = text.match(/^[A-Za-z_$][A-Za-z0-9_$-]*/);
  return ident ? ident[0] : null;
}

/** Every repo-relative path and each `/`-boundary suffix → the real path(s) it names. */
function buildPathIndex(root) {
  const suffixes = new Map();
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), childRel);
      } else if (entry.isFile()) {
        const parts = childRel.split('/');
        for (let i = 0; i < parts.length; i += 1) {
          const key = parts.slice(i).join('/');
          const hit = suffixes.get(key);
          if (hit) hit.push(childRel);
          else suffixes.set(key, [childRel]);
        }
      }
    }
  };
  walk(root, '');
  return suffixes;
}

/** Memoized file reads. */
const fileTextCache = new Map();
function fileText(root, rel) {
  let text = fileTextCache.get(rel);
  if (text === undefined) {
    try {
      text = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch {
      text = '';
    }
    fileTextCache.set(rel, text);
  }
  return text;
}

/** Expand `F-001–F-015`, `F-001-F-015` and `F-179 through F-187` into members. */
function expandRanges(text, into) {
  const rangeRe = /F-(\d{1,4})\s*(?:[–—-]|through|to)\s*\**F-?(\d{1,4})\b/g;
  for (const m of text.matchAll(rangeRe)) {
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    if (hi >= lo && hi - lo < 500) for (let n = lo; n <= hi; n += 1) into.add(n);
  }
}

function main() {
  const suffixes = buildPathIndex(REPO_ROOT);
  const plainPathBaseline = loadPlainPathBaseline();
  // Baseline keys that reproduced; the complement is reported as stale, never fatal.
  const baselineHits = new Set();

  const docs = fs
    .readdirSync(DOCS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort();

  const findingsText = fs.readFileSync(path.join(REPO_ROOT, FINDINGS_REL), 'utf8');

  // Live entries: `### F-NNN` at any heading level.
  const liveIds = new Set();
  for (const m of findingsText.matchAll(/^#+\s+\**F-(\d{1,4})\b/gm)) liveIds.add(Number(m[1]));

  const firstSection = findingsText.search(/^##\s/m);
  const header = firstSection === -1 ? findingsText : findingsText.slice(0, firstSection);
  const recordedIds = new Set();
  for (const m of header.matchAll(F_ID_RE)) recordedIds.add(Number(m[1]));
  expandRanges(header, recordedIds);

  const badFileRefs = [];
  const badIds = [];
  const badAnchors = [];
  const badSourceIds = [];
  const badPlainPaths = [];
  let sourceIdRefCount = 0;
  let sourceFileCount = 0;

  /** Class (d): every `F-NNN` in a source comment resolves, same rule as (b). */
  const walkSourceIds = (dir, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (SOURCE_ID_SKIP.has(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walkSourceIds(path.join(dir, entry.name), childRel);
      } else if (entry.isFile() && SOURCE_ID_EXT.test(entry.name)) {
        sourceFileCount += 1;
        const src = fs.readFileSync(path.join(dir, entry.name), 'utf8').split('\n');
        src.forEach((line, i) => {
          for (const m of line.matchAll(F_ID_RE)) {
            sourceIdRefCount += 1;
            const id = Number(m[1]);
            if (!liveIds.has(id) && !recordedIds.has(id)) {
              badSourceIds.push({ doc: childRel, line: i + 1, id: `F-${m[1]}` });
            }
          }
        });
      }
    }
  };
  for (const root of SOURCE_ID_ROOTS) walkSourceIds(path.join(REPO_ROOT, root), root);
  let fileRefCount = 0;
  let idRefCount = 0;
  let anchorCount = 0;
  let plainPathCount = 0;
  let baselinedPlainPaths = 0;
  let skippedCaptureRefs = 0;
  let allowedDeadRefs = 0;

  for (const name of docs) {
    const rel = `docs/${name}`;
    const lines = fs.readFileSync(path.join(DOCS_DIR, name), 'utf8').split('\n');
    // The findings log's header is the tombstone record: its ids are not references.
    const headerEndLine =
      rel === FINDINGS_REL ? header.split('\n').length : 0;
    // Class (e) only; the other classes read fenced blocks too.
    let inFence = false;

    lines.forEach((line, i) => {
      const lineNo = i + 1;
      const isFenceMarker = FENCE_RE.test(line);
      if (isFenceMarker) inFence = !inFence;

      for (const m of line.matchAll(FILE_REF_RE)) {
        fileRefCount += 1;
        if (suffixes.has(m[1])) continue;
        if (DATED_CAPTURES.has(rel)) {
          skippedCaptureRefs += 1;
          continue;
        }
        const ref = `${m[1]}:${m[2]}`;
        if (KNOWN_DEAD_REFS.has(`${rel}::${ref}`)) {
          allowedDeadRefs += 1;
          continue;
        }
        badFileRefs.push({ doc: rel, line: lineNo, ref });
      }

      for (const m of line.matchAll(SYMBOL_ANCHOR_RE)) {
        const symbol = normalizeSymbol(m[2]);
        if (!symbol) continue; // nothing checkable after the `›` — not a claim
        anchorCount += 1;
        if (DATED_CAPTURES.has(rel)) {
          skippedCaptureRefs += 1;
          continue;
        }
        const targets = suffixes.get(m[1]);
        if (!targets) {
          badAnchors.push({ doc: rel, line: lineNo, ref: `${m[1]} › ${symbol}`, why: 'no such file' });
          continue;
        }
        // Any matching file containing the name is enough (ambiguous basenames).
        if (targets.some((t) => fileText(REPO_ROOT, t).includes(symbol))) continue;
        badAnchors.push({
          doc: rel,
          line: lineNo,
          ref: `${m[1]} › ${symbol}`,
          why:
            targets.length === 1
              ? `not found in ${targets[0]}`
              : `not found in any of ${targets.length} files named ${m[1]}`,
        });
      }

      // (e) PLAIN PATHS. A span is a claim only when the path is ALL of it.
      if (!inFence && !isFenceMarker) {
        for (const m of line.matchAll(CODE_SPAN_RE)) {
          const span = m[1].trim();
          if (!WHOLE_SPAN_PATH_RE.test(span)) continue;
          plainPathCount += 1;
          if (suffixes.has(dealias(span))) continue;
          if (DATED_CAPTURES.has(rel)) {
            skippedCaptureRefs += 1;
            continue;
          }
          if (KNOWN_DEAD_REFS.has(`${rel}::${span}`)) {
            allowedDeadRefs += 1;
            continue;
          }
          const baselineKey = `${rel}::${span}`;
          if (plainPathBaseline.keys.has(baselineKey)) {
            baselinedPlainPaths += 1;
            baselineHits.add(baselineKey);
            continue;
          }
          badPlainPaths.push({ doc: rel, line: lineNo, ref: span });
        }
      }

      if (lineNo <= headerEndLine) return;
      for (const m of line.matchAll(F_ID_RE)) {
        idRefCount += 1;
        const id = Number(m[1]);
        if (!liveIds.has(id) && !recordedIds.has(id)) {
          badIds.push({ doc: rel, line: lineNo, id: `F-${m[1]}` });
        }
      }
    });
  }

  console.log(
    `check-doc-refs: ${docs.length} docs · ${fileRefCount} file refs · ${idRefCount} F-id refs · ` +
      `${anchorCount} symbol anchors · ${plainPathCount} plain path spans`,
  );
  console.log(`  findings log: ${liveIds.size} live entries · ${recordedIds.size} ids recorded in the header`);
  console.log(
    `  not enforced: ${skippedCaptureRefs} dead ref(s) inside ${DATED_CAPTURES.size} dated captures · ` +
      `${allowedDeadRefs}/${KNOWN_DEAD_REFS.size} allowed dead ref(s) in live docs`,
  );
  console.log(
    `  source trees: ${sourceFileCount} files scanned · ${sourceIdRefCount} F-id ref(s) outside docs/`,
  );
  console.log(
    `  plain-path ratchet: ${baselinedPlainPaths} baselined ref(s) matching ` +
      `${baselineHits.size}/${plainPathBaseline.keys.size} key(s) measured ${plainPathBaseline.measuredAt} ` +
      `— DEBT, NOT PASSING CITATIONS`,
  );

  // Stale baseline entries: visible, never fatal (a doc fix must not turn CI red).
  const staleBaseline = [...plainPathBaseline.keys].filter((k) => !baselineHits.has(k)).sort();
  if (staleBaseline.length) {
    console.log(
      `\n○ ${staleBaseline.length} baseline entr(ies) no longer reproduce — the citation was fixed, the\n` +
        `  file came back, or the doc joined DATED_CAPTURES. Delete these lines from\n` +
        `  ${PLAIN_PATH_BASELINE_REL} so the file keeps shrinking (this is NOT a failure):`,
    );
    for (const k of staleBaseline) console.log(`    ${k}`);
  }

  if (badFileRefs.length) {
    console.error(`\n✗ ${badFileRefs.length} file reference(s) point at a path that does not exist:`);
    for (const b of badFileRefs) console.error(`    ${b.doc}:${b.line}  →  ${b.ref}`);
  }

  if (badAnchors.length) {
    console.error(`\n✗ ${badAnchors.length} symbol anchor(s) name something that is not there:`);
    for (const b of badAnchors) console.error(`    ${b.doc}:${b.line}  →  ${b.ref}   (${b.why})`);
    console.error(
      `\n  A symbol anchor is the docs' PREFERRED reference form, so a wrong one is read with\n` +
        `  more confidence than a wrong line number. Fix by repointing the anchor at the file that\n` +
        `  really holds the symbol — or, if nothing holds it, by saying what the code actually does.\n` +
        `  Do NOT "restore" the symbol to make this pass.`,
    );
  }

  if (badPlainPaths.length) {
    console.error(
      `\n✗ ${badPlainPaths.length} NEW plain path reference(s) in a code span name a file that does not exist:`,
    );
    for (const b of badPlainPaths) console.error(`    ${b.doc}:${b.line}  →  ${b.ref}`);
    console.error(
      `\n  A backticked path with no line number and no \`›\` is the citation form these docs are\n` +
        `  TOLD to write, and until 2026-08-26 it was the one form nothing existence-checked — so a\n` +
        `  wrong one has had the longest possible time to look right. These are NEW: they are not in\n` +
        `  the ${plainPathBaseline.measuredAt} baseline, so they rotted after it was measured.\n` +
        `  Fix by repointing the citation at the file that really holds the thing, or by deleting the\n` +
        `  citation if the file is gone and the sentence survives without it. Do NOT create a file to\n` +
        `  make this pass, do NOT demote the path into prose to dodge the check, and ⚠ DO NOT ADD IT TO\n` +
        `  ${PLAIN_PATH_BASELINE_REL} — that file only shrinks. Appending to it is\n` +
        `  how this check stops meaning anything.`,
    );
  }

  if (badIds.length) {
    const uniq = [...new Set(badIds.map((b) => b.id))].sort();
    console.error(`\n✗ ${badIds.length} reference(s) to ${uniq.length} F-id(s) with no live entry and no header record:`);
    console.error(`    ids: ${uniq.join(', ')}`);
    for (const b of badIds) console.error(`    ${b.doc}:${b.line}  →  ${b.id}`);
    console.error(
      `\n  Fix by repointing the reference, or — if the entry was deleted as resolved, which is this\n` +
        `  log's convention — record the id on a dated prune-list line in ${FINDINGS_REL}'s header.\n` +
        `  Do NOT re-add a deleted entry to bring an id back.`,
    );
  }

  if (badSourceIds.length) {
    const uniq = [...new Set(badSourceIds.map((b) => b.id))].sort();
    console.error(
      `\n✗ ${badSourceIds.length} SOURCE reference(s) to ${uniq.length} F-id(s) with no live entry and no header record:`,
    );
    console.error(`    ids: ${uniq.join(', ')}`);
    for (const b of badSourceIds) console.error(`    ${b.doc}:${b.line}  →  ${b.id}`);
    console.error(
      `\n  A code comment citing a finding is read with the same trust as a doc citing one, and\n` +
        `  nothing checked these until 2026-08-18 (F-224). Fix by repointing the comment, or — if the\n` +
        `  entry was deleted as resolved — record the id on a dated prune-list line in\n` +
        `  ${FINDINGS_REL}'s header. ⚠ This check cannot see a MIS-cite to a LIVE id; only a human can.`,
    );
  }

  if (
    badFileRefs.length ||
    badIds.length ||
    badAnchors.length ||
    badSourceIds.length ||
    badPlainPaths.length
  ) {
    console.error('\ncheck-doc-refs: FAIL');
    process.exit(1);
  }

  console.log('check-doc-refs: OK');
}

main();
