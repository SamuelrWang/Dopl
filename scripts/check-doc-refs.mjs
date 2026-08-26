#!/usr/bin/env node
//
// check-doc-refs.mjs — the lint for the docs' rottable reference classes.
//
// WHY THIS EXISTS. A 2026-08-11 measurement over `docs/` put the accuracy of
// inline `path/to/file.ts:NNN` references at ~33%: the line number is a
// snapshot of a file that keeps being edited, and NOTHING in this repo ever
// re-read one. The same sweep found 37 `F-NNN` ids referenced with no entry
// behind them. Both classes rot silently, both mislead the next agent, and
// both are cheap to check — so they are checked here, on every push.
//
// AND THEN THE THIRD CLASS PROVED THE POINT (added 2026-08-11, same day). The
// docs' PREFERRED anchor form — `path › symbolName` — was never checked at all,
// and an adversarial read of `docs/INVARIANTS.md` found
// `shared/api/error-handler.ts › withErrorHandler` sitting in §2: a file that
// has never existed in this repo, naming a wrapper nothing ever exported. It
// had been copied from `docs/ENGINEERING.md`, which had carried the fiction for
// months. A symbol anchor is MORE durable than a line number and MORE
// confident-looking, which is exactly why an unchecked one is worse: the next
// agent greps for a symbol, finds nothing, and assumes the tree drifted.
//
// AND THEN THE GATE TURNED OUT TO EXEMPT THE FORM THE DOCS ARE TOLD TO USE
// (class (e), added 2026-08-26). `FILE_REF_RE` requires a `:LINE` suffix and
// `SYMBOL_ANCHOR_RE` requires a `›`, so a PLAIN backticked path —
// `` `src/features/knowledge/server/service-grants.ts` `` — was never
// existence-checked by anything. That is precisely the citation form CLAUDE.md's
// standing rule 2 PRESCRIBES ("never a bare line number"), so for two weeks the
// script enforced existence only on the two forms the docs are instructed not to
// write, and passed the one they are instructed to write. Live proof at the time:
// `docs/REFACTOR-FINDINGS.md`'s F-334 entry cited a migration filename that
// belongs to a different migration and a `service-grants.ts` under
// `src/features/channels/` that has never existed — both green.
//
// WHAT IT CHECKS.
//
//   (a) FILE REFERENCES — `path/to/file.ext:NNN`. It asserts the FILE EXISTS.
//       It does NOT assert the line number is right, and it never will:
//       verifying a line means knowing what was supposed to be there, which is
//       the judgement the doc is making. Line numbers rot; existence is a fact
//       a script can hold. The rule the docs adopt alongside this check is to
//       prefer `path › symbolName` anchors, which survive edits above them —
//       this script is the floor, not the ceiling.
//
//   (c) SYMBOL ANCHORS — `path/to/file.ext › symbolName`. TWO assertions: the
//       file exists, AND the symbol's name appears somewhere in it as PLAIN
//       TEXT. Containment, not parsing, and the weakness is deliberate — a
//       parse would need a TypeScript program per doc reference and would still
//       have to decide what "defined" means across `export const`, a class
//       method, an object literal key and a `.js` CommonJS export. Containment
//       costs a `readFileSync` and catches the failure that actually happens:
//       the symbol IS NOT THERE AT ALL, because it was renamed, deleted, or —
//       as above — never existed. A symbol that moved to a different file in
//       the same sentence's tree still fails, which is correct: the anchor
//       names a file.
//
//       ANCHOR TEXT IS NORMALIZED before the search (`normalizeSymbol`), because
//       the docs legitimately write the symbol with its shape attached —
//       `resolveActiveWorkspace(userId, headerWorkspaceId)`, `SESSION_ONLY_FIELDS
//       = ["visibility"]`, `"max-lines"`. The signature and the value are prose
//       for the reader; the NAME is the anchor, so the name is what is checked.
//
//       AMBIGUOUS BASENAMES pass on ANY match, exactly like class (a): a bare
//       `route.ts › SESSION_ONLY_FIELDS` resolves against every `route.ts` in
//       the repo and one of them containing the symbol is enough. That is weak
//       and it is the same weak-but-real bargain (a) already makes — it still
//       fires the moment the symbol exists nowhere.
//
//       ⚠ THE CEILING, STATED SO NOBODY MISTAKES A PASS FOR A PROOF: containment
//       does not know a comment from code. `src/shared/lib/http-error.ts ›
//       withErrorHandler` PASSES this check — that file's docblock mentions the
//       name in prose ("by `withErrorHandler` … into a") while nothing exports
//       it. Verified by planting it, 2026-08-11. So the check catches the symbol
//       that exists NOWHERE, not the symbol that exists only as a mention.
//       Deliberately not hardened: stripping comments before the search would
//       start failing anchors that legitimately point at a documented constant
//       or a rule stated in a header, and a checker with false failures gets
//       switched off, which costs more than this gap. A GREEN RUN HERE IS NOT
//       EVIDENCE A SYMBOL IS EXPORTED — it is evidence it is not a ghost.
//
//       Many refs in these docs are BARE BASENAMES (`targeting.js:64`,
//       `route.ts:35-44`) because the surrounding prose already established the
//       tree. Those resolve against any path SUFFIX in the repo, so the check
//       on them is weak (dozens of files are named `route.ts`) but real: it
//       still fires the moment a named file is deleted or renamed, which is the
//       failure that actually happened.
//
//   (e) PLAIN PATH REFERENCES IN INLINE CODE SPANS — a markdown single-backtick
//       span whose ENTIRE trimmed content is a path, e.g.
//       `` `src/features/channels/server/service.ts` ``. It asserts the FILE
//       EXISTS, resolving through the same suffix index and taking the same
//       ambiguous-basename bargain as (a) and (c): any suffix match passes.
//
//       THE NARROW RULE IS THE WHOLE DESIGN, and it is what makes this class
//       safe where a general bare-path scan was refused for months. Only inline
//       code spans are read — PROSE IS NEVER SCANNED, so `a MAPPING.md next to
//       it` is still invisible, which is the sentence that killed the earlier
//       attempt. Inside a span, the path must be the ENTIRE content: the match
//       is anchored `^…$`, which by construction excludes a sentence, a glob
//       (`*`), a call signature, a `:NNN` (class (a) owns that) and a `›`
//       (class (c) owns that). A span is either a naked path claim or it is not
//       this class; there is no partial credit and therefore no guessing.
//       Fenced code blocks are skipped — inside one, backticks are content, and
//       a path in a sample command or a directory listing is an ILLUSTRATION,
//       not a citation.
//
//       ⚠ CLASS (e) IS A RATCHET, and that is a compromise stated out loud. The
//       run that introduced it found 613 dead plain paths already sitting in
//       `docs/` (measured 2026-08-26), dominated by `docs/ENGINEERING.md`'s
//       archaeology — prose about how the system got here, naming files this repo
//       DELETED ON PURPOSE. Failing on all 613 would have turned CI red on a
//       backlog nobody had triaged, and a red CI that everyone learns to ignore
//       is worth less than no check at all. So the pre-existing set is recorded
//       in `scripts/doc-refs-plain-path-baseline.json` and reported as BASELINED;
//       anything NOT in that file fails. New rot is caught from day one; old rot
//       is measured instead of hidden.
//
//       THE BASELINE ONLY SHRINKS, and the script enforces both halves of that:
//       an entry that no longer reproduces is printed as STALE with an
//       instruction to delete it (NEVER a failure — fixing a doc must not turn CI
//       red), and the file is not a place to add things. A newly dead path is
//       fixed at the citation or the citation is deleted. Appending to the
//       baseline is how this check stops meaning anything, which is why there is
//       deliberately NO flag on this script that regenerates it.
//
//       ⚠ THE OTHER CEILING: A BASELINED REF IS UNCHECKED DEBT, NOT A PASSING
//       CITATION. A green run means "no NEW dead plain paths", never "the docs'
//       paths are good". 457 keys in that file are 457 citations a reader will
//       follow to nothing.
//
//       TS PATH ALIASES are un-aliased first (`PATH_ALIASES`): a span written as
//       an import specifier — `@/features/…/x.tsx` — is a real reference to a
//       real file and must not be reported as missing. That was the ONE false
//       failure this class produced on its first run, and it is fixed at the
//       resolver, not by narrowing what counts as a claim.
//
//       `DATED_CAPTURES` and `KNOWN_DEAD_REFS` are honoured exactly as (a)
//       honours them; a per-reference exemption keys on the bare path
//       (`doc.md::path/to/file.ts`). The findings log's header block is NOT
//       skipped here — the F-id classes skip it because it is a tombstone
//       record of ids, but a PATH written there is still a claim about the tree.
//
//       ⚠ THE CEILING: a code span that is prose is not scanned, and that is on
//       purpose. `` `MAPPING.md is gone` `` and `` `see src/foo.ts for why` ``
//       both pass, because widening past the anchored match is how this check
//       starts producing false failures — and a checker with false failures gets
//       switched off, which costs more than the gap. This catches the CONFIDENT
//       NAKED PATH, which is the form the docs are told to write and the form
//       that had never been checked.
//
//   (d) FINDING IDS IN SOURCE — every `F-NNN` mention in the SOURCE trees
//       (`src/`, `packages/*/src`, `apps/`, `dopl-desktop-app/`, `scripts/`,
//       `supabase/`) must resolve exactly as class (b) requires inside `docs/`.
//       ADDED 2026-08-18 (F-224), after a review found five source files citing
//       `F-203` where they meant `F-206` and this script had never looked
//       outside `docs/`. **STATE THE CEILING, because it is the same ceiling
//       (b) has: this catches a DANGLING id, never a MIS-CITED one.** `F-203`
//       is a live entry, so those five would have passed even under this class
//       — what it catches is the id that resolves to nothing at all, which is
//       the failure that rots silently when an entry is deleted as resolved.
//       Measured at the time it was added: 208 source files carry an `F-NNN`
//       and every id in them resolved, so this went in green rather than with
//       a backlog. `dist/` is skipped here (and only here) — the committed
//       build output is generated, so an id in it is not a claim anybody wrote.
//
//   (b) FINDING IDS — every `F-NNN` mention in `docs/*.md` must resolve to
//       either a live `### F-NNN:` heading in REFACTOR-FINDINGS.md, or a
//       mention inside that file's HEADER BLOCK (everything above its first
//       `##`). The header is where the log records what it deleted, and the
//       log's convention is that a resolved entry is DELETED, not struck
//       through — so a dangling id is not automatically a bug, it is a bug ONLY
//       IF the header never recorded it. Ranges (`F-001–F-015`,
//       `F-179 through F-187`) are expanded.
//
// SCOPE: `docs/*.md`, non-recursive on purpose — `docs/audit-2026-06-01/` and
// `docs/migration-research/` are frozen historical snapshots whose references
// SHOULD point at a tree that no longer exists.
//
// Usage: `node scripts/check-doc-refs.mjs`  → exit 0 clean, exit 1 with a named
// list of every miss. No dependencies; no network; read-only.
//
// COST: the symbol check reads source files, which classes (a) and (b) never
// did. Reads are memoized per path, and only files an anchor actually names are
// opened — a few dozen, not the tree. Still well under a second.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const FINDINGS_REL = 'docs/REFACTOR-FINDINGS.md';
const PLAIN_PATH_BASELINE_REL = 'scripts/doc-refs-plain-path-baseline.json';

/**
 * Class (e)'s ratchet: the plain paths that were ALREADY dead when the class was
 * added. Keys are `<docRelPath>::<ref as the code span writes it>` — BEFORE
 * dealiasing, and with NO line number, so an entry survives the doc being
 * reflowed and covers every line in that doc citing that path.
 *
 * A missing or unreadable baseline is a HARD ERROR, not an empty set: silently
 * treating it as empty would fail 457 pre-existing refs and get this script
 * deleted from CI within the hour. It is also not auto-created — see the header
 * on why there is no regenerate flag.
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

// Trees that are either not source or not ours. `dist/` is NOT here: the
// committed build output under `packages/*/dist` is referenced by findings on
// purpose (a bug present in both source and shipped artifact).
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.claude', 'out', 'coverage', '.turbo', '.vercel']);

// DATED CAPTURES — exempt from the file-existence check, and the reason is not
// convenience. Each of these docs states its own capture date in its first
// lines and describes the tree AS IT WAS THEN. Updating their references to
// today's tree would destroy the thing they are for. A dead ref in a
// forward-looking doc is a defect; a dead ref in a snapshot is the record.
// A doc leaves this list by being rewritten as live guidance, never by being
// "cleaned up". DO NOT ADD A LIVE DOC HERE — fix its reference instead.
const DATED_CAPTURES = new Map([
  ['docs/AUDIT-FIX-VERIFICATION.md', 'captured 2026-05-04'],
  // ⚠ Added 2026-08-18, when the wiring plan's Phase 4 deleted the stale-threads cron and
  // `service-tasks-propose.ts` and three of this doc's C-numbered findings went dead with them.
  // It qualifies on the list's own terms rather than on convenience: it is titled with its
  // capture date, its header states the method and the tree it read, and its findings are
  // numbered claims about that tree. Repointing them at today's code would delete the record of
  // what was audited.
  ['docs/CHANNELS-AUDIT-2026-08-07.md', 'audited 2026-08-07'],
  ['docs/CLEANUP.md', 'generated + executed 2026-06-12'],
  ['docs/DATA-LOADING-AUDIT.md', 'audited 2026-06-20'],
  ['docs/M5-M6-M10-AUDIT-FINDINGS.md', 'captured 2026-05-04'],
  ['docs/M7-M11-AUDIT-FINDINGS.md', 'captured 2026-05-04'],
  ['docs/MCP-MULTI-WORKSPACE.md', 'captured 2026-05-03'],
  ['docs/NEXT-SESSION-FIXES.md', 'handoff 2026-08-01, ⛔ superseded 2026-08-05'],
]);

// The narrow, per-REFERENCE escape hatch, for a LIVE doc that names a file this
// repo deliberately deleted. Only two exist, both in the roadmap's retirement
// paragraph, and both are load-bearing there: the sentence is about what the
// retirement removed, so the file is supposed to be gone.
// THIS LIST SHRINKS. Adding to it is how the check stops meaning anything —
// prefer dropping the `:NNN` (a line number into a deleted file resolves to
// nothing) over an entry here.
const KNOWN_DEAD_REFS = new Set([
  'docs/LAUNCH-READINESS-ROADMAP.md::trash/server/service.ts:178',
  'docs/LAUNCH-READINESS-ROADMAP.md::skills-trash-modal.tsx:174',
]);

// `md` joined 2026-08-18 (F-224). A doc that names another doc with a line
// number or a `›` anchor rots exactly like one naming a `.ts` file, and this
// list was the only reason those went unchecked. It now drives classes (a), (c)
// AND (e). ⚠ A BARE path with no `:NNN` and no `›` — the form 42 live citations
// of a deleted `MAPPING.md` used to slip through — is checked as of 2026-08-26,
// but ONLY when it is the entire content of an inline code span (class (e)).
// A path loose in prose is still invisible, and deliberately so: `a MAPPING.md
// next to it` is a sentence, and a checker with false failures gets switched off.
const SOURCE_EXT = 'ts|tsx|mts|cts|js|jsx|mjs|cjs|sql|md';

// Class (d)'s roots: where a `F-NNN` in a COMMENT is a claim somebody wrote.
// `docs/` is absent because classes (a)–(c) already own it.
const SOURCE_ID_ROOTS = ['src', 'packages', 'apps', 'dopl-desktop-app', 'scripts', 'supabase'];
const SOURCE_ID_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|sql)$/;
// Generated output carries whatever its source carried; an id in it is not a
// second claim. This is the one place `dist/` is skipped (see SKIP_DIRS above).
const SOURCE_ID_SKIP = new Set([...SKIP_DIRS, 'dist']);

// The leading lookbehind blocks a match that starts mid-token: it keeps
// `index.d.ts:69` whole instead of matching the `d.ts:69` tail, and it lets a
// ref start right after a `/` so `/members/route.ts:75` still resolves.
const FILE_REF_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9_.-])([A-Za-z0-9_@][A-Za-z0-9_.@/-]*\.(?:${SOURCE_EXT})):(\d+)(?:-(\d+))?`,
  'g',
);

const F_ID_RE = /\bF-(\d{1,4})\b/g;

// `path.ext › symbol`. The symbol half runs to the end of the inline-code span
// (or the line), and `normalizeSymbol` cuts it back to the NAME — so an anchor
// written bare in prose, with a signature, or with its value attached all reduce
// to the same thing. `›` is the SINGLE RIGHT-POINTING ANGLE QUOTATION MARK
// the docs use; nothing else in these files carries it.
const SYMBOL_ANCHOR_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9_.-])([A-Za-z0-9_@][A-Za-z0-9_.@/-]*\.(?:${SOURCE_EXT}))\s*›\s*([^\n\`]+)`,
  'g',
);

// Class (e). CODE_SPAN_RE lifts every single-backtick inline span out of a line;
// WHOLE_SPAN_PATH_RE decides whether that span is a naked path and nothing else.
// The `^…$` anchors are the entire safety argument — see the header on class (e).
// A ```` ```fence ```` line toggles FENCE_RE and the block it opens is skipped.
const CODE_SPAN_RE = /`([^`\n]+)`/g;
const WHOLE_SPAN_PATH_RE = new RegExp(
  String.raw`^[A-Za-z0-9_@#][A-Za-z0-9_.@#/-]*\.(?:${SOURCE_EXT})$`,
);
const FENCE_RE = /^\s{0,3}(?:```|~~~)/;

// TS PATH ALIASES, resolved before the index lookup. These are import specifiers,
// not repo-relative paths, so a literal lookup of `@/features/…/x.tsx` misses a
// file that is really there — the first false-failure class this check produced,
// caught on the run that introduced it (`docs/AGENT-TEMPLATES-SPEC.md`, 2026-08-26).
// Sources: tsconfig.json `@/* → ./src/*`; apps/desktop-ui/tsconfig.json adds
// `#/* → ./src/*` (i.e. apps/desktop-ui/src) and re-points `@/*` at the same root
// `src/`. If a tsconfig gains an alias, it belongs here or this check lies about it.
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
 * The anchor's NAME, or `null` when there is nothing checkable in it.
 *
 * Strips markdown emphasis, then takes the FIRST token: a quoted string's
 * contents (`"max-lines"` → `max-lines`) or a bare identifier, stopping at the
 * `(`, `=`, `.` or space that begins a signature, a value, or the rest of the
 * sentence. A `member.method` anchor keeps only `member` — deliberately: the
 * property half is what a rename is most likely to leave behind correctly, and
 * a false failure here would be paid for by loosening the check.
 *
 * ⚠ `_` IS NOT EMPHASIS HERE. Stripping it (the first cut of this function did)
 * turns `SESSION_ONLY_FIELDS` into `SESSIONONLYFIELDS` and fails every
 * SCREAMING_SNAKE constant in the docs — i.e. the check would have been loudest
 * exactly where the anchors are most correct. These anchors live inside code
 * spans, where `_` was never emphasis to begin with.
 */
function normalizeSymbol(raw) {
  const text = raw.replace(/[*`]/g, '').trim();
  const quoted = text.match(/^["'“”‘’]([^"'“”‘’]+)["'“”‘’]/);
  if (quoted) return quoted[1].trim() || null;
  const ident = text.match(/^[A-Za-z_$][A-Za-z0-9_$-]*/);
  return ident ? ident[0] : null;
}

/**
 * Every repo-relative path, plus every suffix of it at a `/` boundary, mapped to
 * the real repo-relative path(s) that suffix names. Class (a) only needs the
 * KEYS; class (c) has to open the file, so the values are carried too.
 */
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

/** Memoized file reads — one `route.ts` anchor should not re-read 70 files twice. */
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
  // Every baseline key that actually reproduced this run. The complement is the
  // stale set: reported, never fatal.
  const baselineHits = new Set();

  const docs = fs
    .readdirSync(DOCS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort();

  const findingsText = fs.readFileSync(path.join(REPO_ROOT, FINDINGS_REL), 'utf8');

  // Live entries: `### F-NNN: ...` (any heading level, so a future re-nest of
  // the file does not silently empty this set).
  const liveIds = new Set();
  for (const m of findingsText.matchAll(/^#+\s+\**F-(\d{1,4})\b/gm)) liveIds.add(Number(m[1]));

  // Recorded-as-deleted: the header block, everything above the first `##`.
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
    // The findings log's own header IS the tombstone record; the ids it lists
    // are by definition not dangling, so do not re-report them as references.
    const headerEndLine =
      rel === FINDINGS_REL ? header.split('\n').length : 0;
    // Class (e) only. The other classes have always read fenced blocks and this
    // change does not alter that.
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
        // ANY matching file containing the name is enough — see the header on
        // ambiguous basenames.
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
          // THE RATCHET. Already dead when class (e) landed → measured debt, not
          // a failure. Anything else is new rot and fails.
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

  // STALE BASELINE ENTRIES. Visible, never fatal: a doc fix must not turn CI red.
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
