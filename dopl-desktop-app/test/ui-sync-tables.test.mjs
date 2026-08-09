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
//   4. A TABLE IS PUBLISHED THAT NOBODY BINDS — the reverse of (2), and the one
//      failure with no visible symptom at all: it just costs WAL decode + a
//      per-subscription RLS evaluation on every write, forever, for no reader.
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
  return { added, dropped, current: currentPublication(sql), renames, sql };
}

// `added` / `dropped` above are EVER-sets: membership means "some migration, somewhere,
// said this word". They cannot order two statements, so a table ADDed BACK after a DROP
// still reads as dropped — which quietly defeated the one assertion that exists to catch a
// re-publish landing without its subscriber. `current` replays the same statements in
// migration order (filename sort, then byte offset in the concatenated SQL) and answers the
// only question a live system has: is this table published TODAY. The ever-sets stay, and
// stay in use: "was never published at all" and "the bare-DROP scan still works" are
// history questions, and answering them from `current` would be wrong.
function currentPublication(sql) {
  const events = []; // { at, table, published }
  for (const m of sql.matchAll(
    /ALTER PUBLICATION supabase_realtime (ADD|DROP) TABLE (?:public\.)?(\w+)/g
  )) events.push({ at: m.index, table: m[2], published: m[1] === "ADD" });
  const RE_LOOP = /FOREACH\s+tbl\s+IN\s+ARRAY\s+ARRAY\[([^\]]*)\]([\s\S]*?)END LOOP/g;
  for (const m of sql.matchAll(RE_LOOP)) {
    const isAdd = /ADD TABLE/.test(m[2]);
    if (!isAdd && !/DROP TABLE/.test(m[2])) continue;
    for (const q of m[1].matchAll(/'(\w+)'/g)) {
      events.push({ at: m.index, table: q[1], published: isAdd });
    }
  }
  // A BARE `DROP TABLE` un-publishes implicitly (the `skill_files` route). The leading
  // alternative is there to SKIP the `ALTER PUBLICATION … DROP TABLE` tails, which the
  // first scan already filed — regex alternation prefers it at the same start offset.
  const RE_DROP = /(ALTER PUBLICATION supabase_realtime DROP TABLE|DROP TABLE) (?:IF EXISTS )?(?:public\.)?(\w+)/g;
  for (const m of sql.matchAll(RE_DROP)) {
    if (m[1] === "DROP TABLE") events.push({ at: m.index, table: m[2], published: false });
  }
  events.sort((a, b) => a.at - b.at);
  const current = new Set();
  for (const e of events) {
    if (e.published) current.add(e.table);
    else current.delete(e.table);
  }
  return current;
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
  // `current`, not `dropped`: a table that left the publication and was later ADDed back
  // is bindable again, and the ever-set cannot say so. A bare table DROP never re-enters
  // `current`, so the `skill_files` failure this line was written for is still caught.
  const gone = SYNC_TABLES.filter((t) => !PUB.current.has(t));
  assert.deepEqual(gone, [], `dropped or un-published table still bound: ${gone.join(", ")}`);
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

test("the watched set is exactly the 17 tables, in a pinned order", () => {
  // Was 22 until 2026-08-07: the five `workflow_*` names left with the workflows
  // retirement (RETIREMENT-UNWIRING-PLAN.md Phase 5 / D8). Their absence is pinned
  // positively by the un-published test at the bottom, not just by this list.
  assert.deepEqual(SYNC_TABLES, [
    "knowledge_bases", "knowledge_folders", "knowledge_entries",
    "skills", "skill_versions",
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
  // 17 since the workflows retirement dropped the five-name WORKFLOW_TABLES literal out
  // of src/features/workflows/client/realtime.ts (it was 22). The floor is what catches a
  // PARSER drift — a regex that stops matching reads as "nothing subscribes to anything",
  // which would make every assertion in this file vacuously true.
  assert.ok(watched.size >= 17, `only found ${watched.size} feature tables — parser drifted`);
  const covered = new Set([...SYNC_TABLES, ...LISTENER_OWNED_TABLES]);
  const un = [...watched].filter(([t]) => !covered.has(t));
  assert.deepEqual(un.map(([t]) => t), [],
    `hooks subscribe but main binds nothing: ${un.map(([t, f]) => `${t} (${f})`).join(", ")}`);
  // Regression pin: these were absent from the first cut of SYNC_TABLES, so the chats and
  // skills pages would never have updated live. The three `workflow_*` names that used to
  // ride along here moved to the un-published pin below — same failure, opposite sign.
  for (const t of ["chat_messages", "skill_versions"]) {
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

// ── THE PUBLICATION vs EVERY SUBSCRIBER ────────────────────────────────────
// Failure 4, and it is the one direction the tests above never checked: they all
// ask "is everything we BIND published", never "is everything PUBLISHED bound".
// A published table costs WAL decode + a per-subscription RLS evaluation on every
// write whether or not one client has ever subscribed, so an orphan is permanent
// amplification that produces no symptom a user could report (F-094 Residual 3
// measured the poller: realtime.list_changes, 2,968,450 calls / 386.6 min).
//
// The third consumer is READ FROM SOURCE rather than restated. realtime.js keeps
// its own socket outside this feed, so hardcoding what it binds here would let the
// two drift silently — which is the same mistake as omitting it.
const LISTENER_SRC = readFileSync(join(HERE, "..", "main", "realtime.js"), "utf8");
const LISTENER_BOUND = [...LISTENER_SRC.matchAll(/table:\s*'(\w+)'/g)].map((m) => m[1]);

// `public` is a PARSE ARTIFACT, never a table: the DO-loop migrations build their
// statement with `format('… ADD TABLE public.%I', tbl)`, and `%I` is not `\w+`, so
// the regex backtracks and captures the schema. Filtered here rather than in
// publicationState() so the loop scanner keeps reading exactly as it always has.
function livePublication() {
  return [...PUB.current].filter((t) => t !== "public").sort();
}

test("nothing is published that no consumer binds", () => {
  assert.ok(LISTENER_BOUND.length > 0, "the realtime.js binding scan has stopped working");
  const bound = new Set([...SYNC_TABLES, ...LISTENER_OWNED_TABLES, ...LISTENER_BOUND]);
  const orphans = livePublication().filter((t) => !bound.has(t));
  assert.deepEqual(orphans, [], "published but nobody subscribes — drop from "
    + `supabase_realtime or ship the subscriber: ${orphans.join(", ")}`);
  assert.equal(livePublication().length, SYNC_TABLES.length,
    "the publication and the watched set are no longer the same size");
});

// UN-PUBLISHED IS NOT DROPPED — and the SQL scanner above cannot tell the two apart,
// because `ALTER PUBLICATION … DROP TABLE public.x` also matches its bare-`DROP TABLE`
// pass. So `PUB.dropped` is proof the table left the PUBLICATION and is NOT proof the
// table is gone. What proves each one still stands is that server code still reads it
// — which is also the reason each was kept, so the pin and the justification are the
// same fact. (`clusters` predates this migration directory entirely: there is no
// CREATE TABLE for it anywhere, so `createBody` cannot be that evidence.)
//
// The value is the FEATURE that reads the table, not a file inside it. A file path was
// the first cut and it broke on the first refactor that touched no realtime wiring at
// all: deleting the orphaned `listTrashedWorkflows` / `purgeWorkflow` helpers moved the
// `workflows` reads out of `server/repository.ts` into `server/service.ts`, and this
// suite reported a pure code move as "the TABLE is now droppable". Feature ownership is
// the stable fact — a read moving between one feature's own server modules is a
// refactor, a read LEAVING the feature (or vanishing) is the change worth failing on.
const STILL_READ_BY = {
  // 20260807000000 — unbound by attrition: the subscriber was deleted and the
  // publication entry was simply never cleaned up after it.
  channel_agents: "channels", // author attribution (server/repository-agents.ts)
  clusters: "clusters", // cluster CRUD (server/service.ts)
  // 20260807100000 — unbound BY DECISION: the workflows retirement
  // (RETIREMENT-UNWIRING-PLAN.md Phase 5 / D8). Hidden, not deleted — every one of these
  // is still read and written by the server through the API routes left functional (D3).
  workflows: "workflows",
  workflow_steps: "workflows",
  workflow_step_edges: "workflows",
  workflow_knowledge_bases: "workflows",
  workflow_skills: "workflows",
};

/**
 * The feature's server modules that still `.from("<table>")`. Tests are excluded on
 * purpose: a fixture naming the table is not evidence that production code reads it.
 */
function serverReadersOf(feature, table) {
  const dir = join(HERE, "..", "..", "src", "features", feature, "server");
  return readdirSync(dir).filter(
    (f) =>
      f.endsWith(".ts") &&
      !f.endsWith(".test.ts") &&
      readFileSync(join(dir, f), "utf8").includes(`.from("${table}")`)
  );
}

// The five names 20260807100000 removed, kept apart from the map above so the pairing
// assertion can name them as a set and the retirement's own reversal is one edit.
const RETIRED_WORKFLOW_PUB = Object.freeze([
  "workflows", "workflow_steps", "workflow_step_edges",
  "workflow_knowledge_bases", "workflow_skills",
]);

test("every deliberately un-published table stays un-published, and its TABLE stands", () => {
  // Each of these was bound once — channel_agents by the deleted agent-chips hook,
  // clusters by the deleted legacy canvas, the five workflow tables by the retired
  // workflows page — so each has a real ADD in the history and the DROP is what makes it
  // absent, not an oversight. That is what `PUB.added` proves before anything else: a name
  // that was never published would make this whole pin measure nothing.
  for (const t of Object.keys(STILL_READ_BY)) {
    assert.ok(PUB.added.has(t), `${t} was never published — this pin measures nothing`);
    assert.ok(!PUB.current.has(t), `${t} is published again with no subscriber`);
    assert.ok(!SYNC_TABLES.includes(t) && !LISTENER_BOUND.includes(t),
      `${t} has a subscriber again — the publication drop must be reverted WITH it, or `
      + "the channel goes SUBSCRIBED and silently delivers nothing");
    assert.ok(serverReadersOf(STILL_READ_BY[t], t).length > 0,
      `nothing in src/features/${STILL_READ_BY[t]}/server reads ${t} any more — if that `
      + "is real, the TABLE is now droppable and this pin should be replaced by that "
      + "migration, not weakened");
  }
});

test("the workflow retirement un-wired BOTH halves, and neither can come back alone", () => {
  // R4. The two halves are `20260807100000_drop_workflow_tables_from_realtime.sql` and the
  // removal of these names from SYNC_TABLES + the WORKFLOW_TABLES literal in
  // src/features/workflows/client/realtime.ts. Un-publishing is not a table drop: a binding
  // on an unpublished table is ACCEPTED, the channel reports SUBSCRIBED, and no event ever
  // arrives — so a half-revert has no symptom until someone notices a stale page.
  const watched = featureWatchedTables();
  for (const t of RETIRED_WORKFLOW_PUB) {
    assert.ok(!PUB.current.has(t), `${t} is back in supabase_realtime — re-publishing is `
      + "only correct if a subscriber ships in the SAME release");
    assert.ok(!watched.has(t), `${t} is hook-watched again (${watched.get(t)}) but the `
      + "publication drop still stands — that channel will go SUBSCRIBED and deliver nothing");
    assert.ok(!SYNC_TABLES.includes(t), `${t} is bound by main again with no publication`);
  }
  // Not just absent from the list — absent from the WIRING. A `useWorkflowsRealtime` that
  // still calls the shared hook would re-open a per-mount channel on unpublished tables.
  const hookSrc = readFileSync(join(HERE, "..", "..", "src", "features", "workflows",
    "client", "realtime.ts"), "utf8");
  assert.doesNotMatch(hookSrc, /useWorkspaceTablesRealtime\s*\(/,
    "useWorkflowsRealtime subscribes again — it must stay inert while the tables are "
    + "out of supabase_realtime");
  const callerSrc = readFileSync(join(HERE, "..", "..", "src", "features", "workflows",
    "hooks", "use-workflows.ts"), "utf8");
  assert.doesNotMatch(callerSrc, /^\s*useWorkflowsRealtime\(/m,
    "use-workflows.ts calls useWorkflowsRealtime again — remove it or ship the re-publish");
});
