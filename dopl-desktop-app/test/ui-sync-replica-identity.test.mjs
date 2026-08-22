// THE DELETE DOORBELL — replica identity vs the subscription filter.
//
// §2 SPLIT (2026-08-08). `ui-sync-tables.test.mjs` crossed the 500-line cap, and this is the
// seam its own header already draws: that file asks whether the TABLE LIST is honest (parsed
// out of the migrations, cross-checked against the publication, unioned with what the SPA's
// hooks watch). This one asks a different question about the same feed — whether a DELETE on
// a bound table can be DELIVERED at all — and answers it entirely out of the migrations' SQL.
// Two subjects, two files; nothing about either assertion changed in the move.
//
// WHY IT IS ITS OWN FAILURE MODE. Both subscribers bind `filter: workspace_id=eq.<id>`, and a
// filter is matched against the columns in the WAL record. A DELETE has no new tuple — its
// record is the table's REPLICA IDENTITY and nothing else — so under DEFAULT (primary key
// alone) the filter names a column that is not there and the frame is dropped SERVER-SIDE. The
// channel stays SUBSCRIBED, every INSERT and UPDATE keeps arriving, and hard deletes simply
// never come. There is no error anywhere.
//
// Run: `node --test dopl-desktop-app/test/ui-sync-replica-identity.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { between } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// ⚠ THE PURE CORE MOVED to main/ui-sync-core.js on 2026-08-18 (wiring plan Phase 10):
// ui-sync.js sat at exactly the 500-line cap. The sentinels came with it byte for byte.
const SRC = readFileSync(join(HERE, "..", "main", "ui-sync.js"), "utf8");
const CORE = readFileSync(join(HERE, "..", "main", "ui-sync-core.js"), "utf8");

const PURE = between(CORE, "// ─── BEGIN UI-SYNC-PURE", "// ─── END UI-SYNC-PURE",
  "ui-sync pure block");
const { SYNC_TABLES } = new Function(`${PURE}\n return { SYNC_TABLES };`)();

// Every migration, in filename order, concatenated — the same replay the sibling file's
// `publicationState()` does, reduced to the one thing the scans below need.
const PUB = {
  sql: readdirSync(join(HERE, "..", "..", "supabase", "migrations"))
    .filter((f) => f.endsWith(".sql")).sort()
    .map((f) => readFileSync(join(HERE, "..", "..", "supabase", "migrations", f), "utf8"))
    .join("\n"),
};

// ── THE DELETE DOORBELL: REPLICA IDENTITY vs THE SUBSCRIPTION FILTER ────────
// Failure 5, and it is the quietest one in this file. Both subscribers bind
// `filter: workspace_id=eq.<id>`, and a filter is matched against the columns in the
// WAL record. A DELETE has no new tuple — its record is the table's REPLICA IDENTITY
// and nothing else — so under DEFAULT (primary key alone) the filter names a column
// that is not there and the frame is dropped SERVER-SIDE. The channel stays
// SUBSCRIBED, every INSERT and UPDATE keeps arriving, and hard deletes simply never
// come. `20260807150000_replica_identity_for_hard_deletes.sql` fixes that by putting
// `workspace_id` into the identity; this pins the invariant so a future migration
// cannot return one of these tables to DEFAULT and silently undo it.
//
// The INVARIANT, not the mechanism: FULL and `USING INDEX <ix on (workspace_id, …)>`
// both carry the column, and `channel_consent_requests` already satisfies it via FULL
// (set by 20260727130000 for its own UPDATE-delivery reason). New tables may use
// either — what is not allowed is a bound table that must deliver DELETEs sitting at
// DEFAULT.

// Replayed in migration order, exactly like currentPublication(): filename sort, then
// byte offset in the concatenated SQL, so the LAST statement wins.
function replicaIdentityState(sql) {
  const idx = new Map(); // index name -> { table, cols, partial }
  // `[^()]*` on purpose: an expression index (`lower(name)`) is not a legal replica
  // identity, so failing to match one is the right answer, not a parser gap.
  for (const m of sql.matchAll(
    /CREATE UNIQUE INDEX (?:IF NOT EXISTS )?(\w+)\s+ON (?:public\.)?(\w+)\s*\(([^()]*)\)([^;]*);/g
  )) {
    idx.set(m[1], {
      table: m[2],
      cols: m[3].split(",").map((c) => c.trim()),
      partial: /\bWHERE\b/i.test(m[4]),
    });
  }
  const events = [];
  for (const m of sql.matchAll(
    /ALTER TABLE (?:public\.)?(\w+)\s+REPLICA IDENTITY (FULL|DEFAULT|NOTHING|USING INDEX (\w+))/g
  )) events.push({ at: m.index, table: m[1], kind: m[2].split(" ")[0], index: m[3] });
  events.sort((a, b) => a.at - b.at);
  const state = new Map();
  for (const e of events) state.set(e.table, e);
  return { state, idx };
}

const RI = replicaIdentityState(PUB.sql);

/** Does a DELETE on `table` put `workspace_id` in the WAL record? */
function deleteCarriesWorkspaceId(table) {
  const e = RI.state.get(table);
  if (!e) return false; // never altered = DEFAULT = primary key alone
  if (e.kind === "FULL") return true;
  if (e.kind !== "USING") return false;
  const ix = RI.idx.get(e.index);
  return Boolean(ix && ix.table === table && ix.cols.includes("workspace_id"));
}

// The eleven tables whose HARD deletes a user watches happen in another window, and
// which therefore need a DELETE frame of their own. The six omitted names are omitted
// ON PURPOSE and are pinned as such below — the point of listing both is that adding a
// table here is a decision someone has to make, not a default.
const DELETE_DOORBELL_TABLES = Object.freeze([
  "knowledge_bases", "knowledge_folders", "knowledge_entries",
  "skills",
  "ontology_clusters", "ontology_objects", "ontology_memberships",
  "ontology_relationships",
  "chats", "chat_folders",
  "channel_members",
  // ⚠ JOINED 2026-08-22, MOVED OUT OF `NO_DELETE_DOORBELL` BELOW — this list's own
  // instruction ("if the reason has changed, move it to DELETE_DOORBELL_TABLES and say so"),
  // followed. The exemption read "cascade from channels / workspaces only", which was true
  // until a THREAD became deletable (2026-08-21, INVARIANTS §5): `service-tasks-delete.ts ›
  // deleteTask` fires real DELETEs here, and NOTHING else in that cascade is published —
  // `channel_tasks` and `channel_sessions` are both deliberately out (§7), and consent rows
  // are UPDATEd to `expired` rather than deleted. So under DEFAULT the counterparty's UI
  // never learned the thread died. `20260822130000` is the fix.
  "channel_messages",
]);

// Deliberately left at DEFAULT, with the reason that makes it correct. A DELETE these
// tables produce is either invisible to users or already announced by another table's
// event, so paying replica-identity cost for them is the same waste the publication
// trims (20260807000000 / 20260807100000) exist to refuse.
const NO_DELETE_DOORBELL = Object.freeze({
  skill_versions: "cascades from skills; its other delete is the 200-version retention "
    + "trim that runs after EVERY insert — highest-frequency delete of the 17, user-invisible",
  chat_messages: "cascade from chats only (the live merge path is a pure upsert)",
  // ⚠ `channel_messages` STOOD HERE AND HAS MOVED UP (2026-08-22) — see the note on the
  // list above. It is named in place rather than deleted silently, because "cascade from
  // channels / workspaces only" is the kind of reason that stops being true when a feature
  // ships elsewhere, and the next table to leave this map will leave it the same way.
  agent_presence: "never deleted; heartbeat-UPDATEd every 30s per client",
  // Updated 2026-08-08 (C-16 / F-173): a NON-DM delete is now a real DELETE, so
  // "still soft-deletes" stopped being the reason. The exemption survives on a
  // different one — the cascade already rings the doorbell — and that is why the
  // reason is stated rather than the table merely listed.
  channels: "a non-DM delete cascades real DELETEs onto channel_members, which "
    + "DOES carry workspace_id in its identity and rides the SAME refetch signal "
    + "in both subscribers; a DM delete is still an UPDATE. Putting an identity "
    + "here would widen touchChannel — one UPDATE per message posted — for a "
    + "frame that already arrives",
});

test("every table that must deliver DELETEs carries workspace_id in its replica identity", () => {
  for (const t of DELETE_DOORBELL_TABLES) {
    assert.ok(SYNC_TABLES.includes(t), `${t} must be bound by main to deliver anything`);
    assert.ok(deleteCarriesWorkspaceId(t),
      `${t} is at REPLICA IDENTITY DEFAULT, so its DELETE's WAL record is the primary key `
      + "alone and the workspace_id filter can never match it. The channel still reports "
      + "SUBSCRIBED and INSERT/UPDATE still arrive — only hard deletes vanish, with no "
      + "error. Set FULL, or USING INDEX on a unique index leading with workspace_id.");
  }
  // The parser must keep working, or every line above passes vacuously.
  assert.ok(RI.idx.size > 0, "the CREATE UNIQUE INDEX scan has stopped working");
  assert.ok(deleteCarriesWorkspaceId("channel_consent_requests"),
    "the FULL branch has stopped working (20260727130000 sets it on this table)");
});

test("a USING INDEX replica identity names an index Postgres will actually accept", () => {
  // Postgres REQUIRES that index to be unique, non-partial and on NOT NULL columns, and
  // it must keep existing: drop it and the table falls to replica identity NOTHING,
  // where every UPDATE and DELETE on a PUBLISHED table fails outright. That is the one
  // loud failure in this area and it belongs in review, not in a deploy.
  let checked = 0;
  for (const [table, e] of RI.state) {
    if (e.kind !== "USING") continue;
    const ix = RI.idx.get(e.index);
    assert.ok(ix, `${table} points its replica identity at ${e.index}, which no migration `
      + "creates — the ALTER will fail, or worse, a later DROP leaves the table unwritable");
    assert.equal(ix.table, table, `${e.index} is an index on ${ix.table}, not ${table}`);
    assert.ok(!ix.partial, `${e.index} is PARTIAL; Postgres refuses a partial index here`);
    assert.ok(ix.cols.includes("workspace_id"),
      `${e.index} omits workspace_id, so it does not fix DELETE filtering`);
    checked += 1;
  }
  assert.ok(checked >= DELETE_DOORBELL_TABLES.length - 1,
    `only ${checked} USING INDEX identities parsed — the ALTER scan has drifted`);
});

test("the deliberately-DEFAULT tables stay DEFAULT, and the filter they rely on is unchanged", () => {
  for (const [t, why] of Object.entries(NO_DELETE_DOORBELL)) {
    assert.ok(SYNC_TABLES.includes(t), `${t} left the feed — re-check this exemption`);
    assert.ok(!deleteCarriesWorkspaceId(t),
      `${t} gained a workspace_id replica identity. That is not free — it widens the WAL `
      + `record on every UPDATE and DELETE — and the reason it was skipped still reads: ${why}. `
      + "If the reason has changed, move it to DELETE_DOORBELL_TABLES and say so.");
  }
  // The whole fix hangs on the filter COLUMN being workspace_id in both subscribers: a
  // filter on any other column would need that column in the identity instead, and the
  // migration would silently stop covering it.
  const registry = readFileSync(join(HERE, "..", "..", "src", "shared", "realtime",
    "shared-channel-registry.ts"), "utf8");
  for (const [name, src] of [["ui-sync.js", SRC], ["shared-channel-registry.ts", registry]]) {
    assert.match(src, /workspace_id=eq\./,
      `${name} no longer filters on workspace_id — the replica identity in `
      + "20260807150000 was chosen to match that column specifically");
  }
});

