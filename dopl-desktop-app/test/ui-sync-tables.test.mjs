// Phase 3 — the bundled SPA's live-update feed: WHAT IT BINDS (main/ui-sync.js).
//
// §2 SPLIT (2026-08-06). `ui-sync.test.mjs` sat at EXACTLY 500 lines, so the next assertion
// added to it failed `npm run lint` — and it was the next assertion (the `channel_agents`
// binding leaving the feed) that forced the issue. The reflex fix is to delete a comment,
// which is how eight files in this tree converged on the same two numbers; the seam taken
// instead is a real one.
//
// THIS HALF READS THE DATABASE. Everything here is about whether the table list is HONEST:
// parsed out of supabase/migrations, cross-checked against the publication, and unioned with
// what the SPA's own hooks watch. The ~40 lines of SQL parsing below exist for nothing else.
// The other half (`ui-sync.test.mjs`) reads nothing but the sliced pure block — topics,
// backoff, coalescing, forwarding — and needs no migrations at all.
//
// THE FAILURES THIS HALF LOCKS OUT:
//   1. A DEAD TABLE KILLS THE WHOLE FEED — realtime refuses the CHANNEL if any one
//      binding is refused, so ONE bad name costs every table's live updates. Review
//      found exactly that (`skill_files`, dropped outright by 20260716064733), so the
//      list is CHECKED against the migrations rather than trusted.
//   2. A TABLE THE UI WATCHES BUT MAIN DOESN'T BIND is a page that never updates
//      live; the union is re-derived from src/features/*/client/realtime.ts.
//   3. THE CHANNELS EXEMPTION GETS QUIETLY LOST (channel_messages / agent_presence
//      belong to realtime.js).
//
// Run: `node --test dopl-desktop-app/test/ui-sync-tables.test.mjs`
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { between, fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "ui-sync.js"), "utf8");
const PURE = between(SRC, "// ─── BEGIN UI-SYNC-PURE", "// ─── END UI-SYNC-PURE",
  "ui-sync pure block");

const { SYNC_TABLES, LISTENER_OWNED_TABLES } = new Function(
  `${PURE}
   return { SYNC_TABLES, LISTENER_OWNED_TABLES };`
)();

// ── THE TABLE LIST vs THE ACTUAL PUBLICATION ────────────────────────────────
// Parsed once from supabase/migrations: bare `ADD TABLE` statements plus the
// idempotent DO-block loops that ADD every name in an ARRAY[...] literal.

function publicationState() {
  const dir = join(HERE, "..", "..", "supabase", "migrations");
  const sql = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  const added = new Set();
  const dropped = new Set();
  for (const m of sql.matchAll(
    /ALTER PUBLICATION supabase_realtime (ADD|DROP) TABLE (?:public\.)?(\w+)/g
  )) (m[1] === "ADD" ? added : dropped).add(m[2]);
  // The loop form: `FOREACH tbl IN ARRAY ARRAY[ 'a', 'b' ] LOOP … ADD TABLE public.%I`
  const RE_LOOP = /FOREACH\s+tbl\s+IN\s+ARRAY\s+ARRAY\[([^\]]*)\]([\s\S]*?)END LOOP/g;
  for (const m of sql.matchAll(RE_LOOP)) {
    const set = /ADD TABLE/.test(m[2]) ? added : /DROP TABLE/.test(m[2]) ? dropped : null;
    if (set) for (const q of m[1].matchAll(/'(\w+)'/g)) set.add(q[1]);
  }
  // A BARE `DROP TABLE` un-publishes implicitly, leaving the original ADD in the
  // history looking authoritative — that is what let `skill_files` pass review.
  for (const m of sql.matchAll(/DROP TABLE (?:IF EXISTS )?(?:public\.)?(\w+)/g)) {
    dropped.add(m[1]);
  }
  // `ALTER TABLE x RENAME TO y` — the CREATE for `y` is filed under `x`.
  const renames = new Map();
  for (const m of sql.matchAll(/ALTER TABLE (?:public\.)?(\w+) RENAME TO (\w+)/g)) renames.set(m[2], m[1]);
  return { added, dropped, renames, sql };
}

const PUB = publicationState();

// The CREATE TABLE body for a table, following renames back to its original name.
function createBody(table, seen = new Set()) {
  const m = new RegExp(
    `CREATE TABLE (?:IF NOT EXISTS )?(?:public\\.)?${table}\\s*\\(([\\s\\S]*?)\\n\\);`
  ).exec(PUB.sql);
  if (m) return m[1];
  const prev = PUB.renames.get(table);
  if (prev && !seen.has(prev)) return createBody(prev, seen.add(table));
  return null;
}

test("every watched table is real: published, never dropped, workspace-scoped", () => {
  // Failure 1, all three routes into it. A name that is unpublished, dropped, or
  // missing workspace_id refuses its binding — and one refused binding refuses the
  // WHOLE channel, so it costs every other table's live updates too.
  const missing = SYNC_TABLES.filter((t) => !PUB.added.has(t));
  assert.deepEqual(missing, [], `not published by any migration: ${missing.join(", ")}`);
  const gone = SYNC_TABLES.filter((t) => PUB.dropped.has(t));
  assert.deepEqual(gone, [], `dropped table still bound: ${gone.join(", ")}`);
  for (const t of SYNC_TABLES) {
    const body = createBody(t);
    assert.ok(body, `no CREATE TABLE found for ${t}`);
    assert.match(body, /\bworkspace_id\b/, `${t} has no workspace_id column`);
  }
  // Both scanners must keep working, or this test silently stops checking anything:
  // the bare-DROP scan is what `skill_files` slipped past, and the rename follower is
  // what keeps skill_versions (created as skill_file_versions) from reading as bare.
  assert.ok(PUB.dropped.has("skill_files"), "the bare-DROP scan has stopped working");
  assert.ok(createBody("skill_versions"), "the rename follower has stopped working");
});

test("the watched set is exactly the 23 tables, in a pinned order", () => {
  assert.deepEqual(SYNC_TABLES, [
    "knowledge_bases", "knowledge_folders", "knowledge_entries",
    "skills", "skill_versions",
    "workflows", "workflow_steps", "workflow_step_edges",
    "workflow_knowledge_bases", "workflow_skills",
    "ontology_clusters", "ontology_objects", "ontology_memberships",
    "ontology_relationships",
    "chats", "chat_messages", "chat_folders",
    "channel_consent_requests", "channels", "channel_members",
    "channel_messages", "agent_presence",
  ]);
  assert.equal(new Set(SYNC_TABLES).size, SYNC_TABLES.length, "duplicate binding");
  assert.ok(!SYNC_TABLES.includes("skill_files"), "skill_files no longer exists as a table");
});

// ── THE RENDERER CONTRACT ──────────────────────────────────────────────────
// A table a hook watches but main never binds is a page that silently never updates
// live. Re-derived from the feature sources so none can drop out by omission.
function featureWatchedTables() {
  const root = join(HERE, "..", "..", "src", "features");
  const tables = new Map(); // table -> the file that subscribes to it
  for (const feat of readdirSync(root)) {
    for (const rel of [["client", "realtime.ts"], ["constants.ts"]]) {
      const f = join(root, feat, ...rel);
      let src;
      try {
        src = readFileSync(f, "utf8");
      } catch {
        continue; // this feature has no realtime surface
      }
      // `const X_TABLES = [ "a", "b" ] as const;` — the only shape these files use.
      for (const m of src.matchAll(/_TABLES\s*=\s*\[([\s\S]*?)\]\s*as const/g)) {
        for (const q of m[1].matchAll(/"(\w+)"/g)) if (!tables.has(q[1])) tables.set(q[1], f);
      }
    }
  }
  return tables;
}

test("every table the SPA's feature hooks watch is covered by main", () => {
  const watched = featureWatchedTables();
  assert.ok(watched.size >= 20, `only found ${watched.size} feature tables — parser drifted`);
  const covered = new Set([...SYNC_TABLES, ...LISTENER_OWNED_TABLES]);
  const un = [...watched].filter(([t]) => !covered.has(t));
  assert.deepEqual(un.map(([t]) => t), [],
    `hooks subscribe but main binds nothing: ${un.map(([t, f]) => `${t} (${f})`).join(", ")}`);
  // Regression pin: these five were absent from the first cut of SYNC_TABLES, so the
  // chats, skills and workflows pages would never have updated live.
  for (const t of ["chat_messages", "skill_versions", "workflow_step_edges",
    "workflow_knowledge_bases", "workflow_skills"]) {
    assert.ok(watched.has(t), `${t} is no longer hook-watched — re-check the union`);
    assert.ok(SYNC_TABLES.includes(t), `${t} must be bound by main`);
  }
});

// ── THE CHANNELS EXEMPTION ──────────────────────────────────────────────────

test("the channels exemption protects the listener MODULES, not the UI feed", () => {
  // First dogfood: excluding the channel tables from THIS feed froze the
  // app's transcript. The UI watches them on its own socket; the exemption
  // means realtime.js / realtime-agents.js stay untouched (asserted by the
  // desktop suite generally), so the once-excluded set is now empty.
  assert.deepEqual(LISTENER_OWNED_TABLES, []);
  for (const t of ["channel_messages", "agent_presence"]) {
    assert.ok(SYNC_TABLES.includes(t), `${t} must feed the UI (web parity)`);
    assert.ok(PUB.added.has(t), `${t} is not published`);
  }
  // `channel_agents` LEFT the feed on 2026-08-06. Nothing has written that table since the
  // rollback removed named agents, so the binding could never fire — it cost a
  // postgres_changes subscription per workspace to deliver nothing. The table itself stays
  // (historical author_agent_id attribution), which is why this asserts the BINDING is gone
  // rather than the table.
  assert.ok(!SYNC_TABLES.includes("channel_agents"), "a write-dead table needs no change feed");
  const fn = fnOf(SRC, "connect");
  assert.match(fn, /for \(const table of SYNC_TABLES\)/, "bindings must come from the list");
});

