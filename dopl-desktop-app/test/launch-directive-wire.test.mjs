// THE LAUNCH-DIRECTIVE WIRE CONTRACT (main/launch-directive-wire.js) — 2026-08-22.
//
// WHY IT IS ITS OWN FILE. `launch-directives.test.mjs` drives the WATCHER — the toggle, the owner
// check, the claim, the containment inputs, the decision. This drives the CONTRACT: the shapes
// that cross to a server another lane owns. The two change on completely different clocks (one
// when this machine's behaviour moves, one when the schema or a route does), and together they
// overran the 500-line cap `test/**/*.mjs` is linted under. Same seam and same precedent as
// `session-state-push-identity.test.mjs` and `_channel-prefs-block.mjs`.
//
// ⚠ EVERY CLAIM HERE IS PINNED AGAINST THE SERVER'S OWN SOURCE, and that is the whole point of
// the file. The server half landed mid-wave, so the body shapes are driven against
// `schema-launch.ts` and the two paths this lane spends are driven against the real route files —
// the discipline `session-state-push.test.mjs` follows for `SESSION_KEY_RE`, and the reason a
// fixture here would be worthless: a suite that agrees with itself is exactly how a machine goes
// green about a payload the server 400s.
//
// ⚠ ONE GENUINE GAP IS ASSERTED AS THE MEASUREMENT IT IS — **F-273**, the missing
// pending-directives READ, which is why the breaker-open backstop cannot recover a missed
// directive. That case FAILS the day the read lands, deliberately.
//
// Run: `node --test dopl-desktop-app/test/launch-directive-wire.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { boot, claimPosts } from "./_launch-directive-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const require_ = createRequire(import.meta.url);

const SRC = readFileSync(join(MAIN, "launch-directives.js"), "utf8");
const wire = require_(join(MAIN, "launch-directive-wire.js"));

const WS = "11111111-1111-4111-8111-111111111111";
const CH = "22222222-2222-4222-8222-222222222222";
const TH = "33333333-3333-4333-8333-333333333333";
const ME = "44444444-4444-4444-8444-444444444444";
const DID = "66666666-6666-4666-8666-666666666666";

/**
 * ⚠ **THE MAPPER MOVED ON 2026-09-01** — `service-launch.ts` hit the §1 cap when the
 * agent-management kinds gave `toDirective` a second service (`service-launch-agent.ts`), so the
 * row → DTO half lives in `service-launch-dto.ts` now. Named once here rather than at four call
 * sites, because a suite that pins the OTHER TREE'S SOURCE has to be repointed as one thing when
 * that source moves — four independent path literals is four chances to leave one asserting
 * against a file that no longer contains what it is asserting about.
 */
const DTO_FILE = "service-launch-dto.ts";

/** A pending directive row, as the server would write it (snake_case, like a realtime frame). */
const row = (over = {}) => ({
  id: DID,
  workspace_id: WS,
  channel_id: CH,
  task_id: TH,
  operator_user_id: ME,
  goal: "Draft the release notes",
  model: "claude-opus-5",
  status: "pending",
  ...over,
});

// ── 1. THE WIRE CONTRACT (⚠ LOCAL-ONLY — see the header) ─────────────────────────────────

test("CONTRACT: the refusal words are this tree's existing vocabulary, verbatim", () => {
  // ⚠ THE ONE SHAPE HERE THAT IS NOT A GUESS. It is pinned against `session-launch.js`, which
  // PRODUCES these, so a new refusal added there fails HERE rather than reaching an
  // orchestrator as a word it has no copy for.
  // ⚠ SEVEN SINCE 2026-08-22 (agent templates): `no-template`. It is the one member with NO
  // producer in `session-launch.js` — the funnel cannot fail to resolve a template, because the
  // resolve happens above it — so the loop below is a subset check in that direction only.
  // ⚠ NINE SINCE 2026-09-01 (external end / rename). `no-session` and `bad-name` also have no
  // producer in `session-launch.js` — they belong to the AGENT-MANAGEMENT kinds, whose producer
  // is `directive-agent-ops.js` — so the subset loop below stays one-directional and the two are
  // pinned against THAT file instead, in section 4.
  assert.deepEqual(wire.REFUSAL_REASONS,
    ["cap", "busy", "no-sdk", "auth-hold", "no-bridge", "no-counterparty", "no-template",
      "no-session", "bad-name"]);
  const launchSrc = readFileSync(join(MAIN, "session-launch.js"), "utf8");
  const produced = [...launchSrc.matchAll(/skipped: '([a-z-]+)'/g)].map((m) => m[1]);
  for (const word of produced) {
    // `disabled` is the documented exception and maps to `no-bridge` — see `refusalFor`.
    if (word === "disabled") continue;
    assert.ok(wire.REFUSAL_REASONS.includes(word),
      `session-launch.js produces '${word}' and the wire vocabulary has no member for it`);
  }
});

test("CONTRACT: an unknown skip shape becomes `no-bridge`, never a seventh word", () => {
  assert.equal(wire.refusalFor("cap"), "cap");
  assert.equal(wire.refusalFor("disabled"), "no-bridge");
  for (const junk of [undefined, null, "", "kaboom", 7, {}]) {
    assert.equal(wire.refusalFor(junk), "no-bridge", String(junk));
  }
});

// ⚠ DRIVEN AGAINST THE SERVER'S OWN SCHEMA, which landed mid-wave. `LaunchDecideSchema` is a
// DISCRIMINATED UNION — `launched` REQUIRES an agent id and `refused` REQUIRES a reason — so an
// object with two optionals would be refused, and that union is exactly why `decideBody` has two
// shapes and no third.
test("CONTRACT: the claim and decide bodies are `schema-launch.ts`'s, field for field", () => {
  const SCHEMA = readFileSync(
    join(HERE, "..", "..", "src", "features", "channels", "schema-launch.ts"), "utf8"
  );
  assert.match(SCHEMA, /LaunchClaimSchema = z\.object\(\{\s*directiveId: z\.string\(\)\.uuid\(\)/);
  assert.match(SCHEMA, /LaunchDecideSchema = z\.discriminatedUnion\("status"/);
  assert.deepEqual(Object.keys(wire.claimBody(DID)), ["directiveId"]);
  assert.deepEqual(Object.keys(wire.decideBody(DID, { agentId: "a1b2c3d4" })).sort(),
    ["agentId", "directiveId", "status"]);
  assert.deepEqual(Object.keys(wire.decideBody(DID, { refused: "cap" })).sort(),
    ["directiveId", "refusalReason", "status"]);
  // ⚠ THE AGENT ID REGEX IS THE COLUMN'S CHECK AND `agent-id.js`'s charset, character for
  // character — a bad value must be a 400 that NAMES the field, not an opaque 500.
  assert.match(SCHEMA, /\/\^\[a-z\]\[a-z0-9\]\{7\}\$\//);
  assert.match(wire.decideBody(DID, { agentId: "a1b2c3d4" }).agentId, /^[a-z][a-z0-9]{7}$/);
});

const API = join(HERE, "..", "..", "src", "app", "api", "channels", "launch-directives");
const routeSrc = (...p) => { try { return readFileSync(join(API, ...p, "route.ts"), "utf8"); } catch (_e) { return ""; } };
const ROUTES_PENDING_PATH = wire.ROUTES.pending;

// ⚠ THE TWO PATHS THIS LANE SPENDS ARE PINNED TO REAL ROUTE FILES, not to a fixture — the same
// discipline `session-state-push.test.mjs` follows for `SESSION_KEY_RE`. A rename on the server
// fails HERE, where it is one line, rather than in the field, where it is a claim that silently
// never happens and a directive that always expires.
test("CONTRACT: the claim and decide routes exist, take POST, and answer `{ directive }`", () => {
  for (const [name, path] of [["claim", wire.ROUTES.claim], ["decide", wire.ROUTES.decide]]) {
    const src = routeSrc(name);
    assert.ok(src, `no route file at ${path}`);
    assert.match(src, /export const POST = withWorkspaceAuth/, `${name} must be an authed POST`);
    assert.match(src, /NextResponse\.json\(\{ directive \}\)/, `${name} answers { directive }`);
    assert.equal(path, `/api/channels/launch-directives/${name}`);
  }
});

// ⚠ **F-273 IS CLOSED, AND THIS CASE IS THE INVERSE OF WHAT IT WAS.** It used to assert the
// ABSENCE of a collection GET — the measurement that justified the backstop standing itself
// down — with its own comment saying it would fail the day the read landed and that failing
// was the PROMPT to finish. The read landed on 2026-08-22 (`GET /api/channels/launch-directives`,
// over `service-launch.ts › listPendingLaunchDirectives`), so the case is flipped rather than
// deleted: the pin that mattered was never "there is no route", it was "this module and that
// route agree about whether there is one".
// ⚠ `ROUTES.pending` NEEDED NO REPOINT — the server landed the read on the collection path this
// module had already guessed.
test("CONTRACT: the pending-directives read exists and answers `{ directives }` (F-273 closed)", () => {
  assert.match(routeSrc(), /export const GET = withWorkspaceAuth/,
    "the backstop's collection read is gone again — the poll cannot discover a missed directive");
  assert.match(routeSrc(), /NextResponse\.json\(\{ directives \}\)/,
    "the envelope moved; `pollWorkspace` reads `body.directives || body.rows`");
  assert.match(routeSrc(), /export const POST = withWorkspaceAuth/, "…and the FILE path is unchanged");
  assert.equal(ROUTES_PENDING_PATH, "/api/channels/launch-directives",
    "ROUTES.pending must name the collection path the server actually serves");
});

// ⚠ **THE SELF-DISABLE IS NOW DEAD-BUT-HARMLESS, AND IT IS DELIBERATELY LEFT IN.** `pollUnavailable`
// trips only on a 404, which a deployment carrying this route no longer returns — but an OLDER
// deployment still does (INVARIANTS §13: an older peer is supported), and on one of those the
// stand-down is still exactly the right behaviour. Removing it would trade a dead branch for a
// per-minute dead request against every server that has not shipped the route yet.
test("the 404 stand-down survives for OLDER servers, and still names the gap", () => {
  assert.match(SRC, /pollUnavailable = true;/, "the poll stands down on a 404");
  assert.match(SRC, /F-273/, "…and says which gap it is standing down for");
});

// ── ⚠ THE POLLED ROW IS A **DTO**, NOT A RAW ROW — F-284 ─────────────────────────────────
//
// The two roads into `handle` carry two different shapes: realtime hands over `payload.new`, the
// RAW row, while the backstop poll hands over whatever `GET /api/channels/launch-directives`
// answered — `service-launch.ts › toDirective`'s output. Every fixture in these suites was built
// in the raw spelling, so nothing drove the DTO through `handle`, and the DTO was missing
// `operator_user_id` entirely: `directiveFrom` yielded `operatorUserId: ''`, `handle`'s local
// owner re-check compared `'' !== <me>` and returned before the claim, silently. The F-273
// backstop polled every 60s per unhealthy workspace and recovered NOTHING while looking healthy.
//
// ⚠ THE FIXTURE BELOW IS BUILT FROM THE MAPPER'S OWN KEY LIST, not hand-typed, so a field the
// server stops emitting fails HERE rather than in the field.

/** `toDirective`'s output shape, read out of the server's own source. */
const dtoKeys = () => {
  const service = readFileSync(
    join(HERE, "..", "..", "src", "features", "channels", "server", DTO_FILE), "utf8"
  );
  const body = service.slice(service.indexOf("function toDirective"));
  return [...body.slice(0, body.indexOf("\n}")).matchAll(/^\s{4}([A-Za-z]+):/gm)].map((m) => m[1]);
};

test("CONTRACT: the pending-read DTO carries `operatorUserId` (F-284)", () => {
  assert.ok(dtoKeys().includes("operatorUserId"),
    "without it every POLLED row fails handle's owner re-check and the backstop recovers nothing");
  const service = readFileSync(
    join(HERE, "..", "..", "src", "features", "channels", "server", DTO_FILE), "utf8"
  );
  assert.match(service, /operatorUserId: row\.operator_user_id/);
  // …and the TYPE mirrors carry it too, or the mapper does not compile / the SDK cannot read it.
  for (const p of [
    ["..", "..", "src", "features", "channels", "types-launch.ts"],
    ["..", "..", "packages", "dopl-client", "src", "launch-types.ts"],
  ]) {
    assert.match(readFileSync(join(HERE, ...p), "utf8"), /operatorUserId: string;/, p.join("/"));
  }
});

// ⚠ THE END-TO-END HALF. The case above pins the mapper; this one drives a directive built in the
// DTO's OWN spelling through the real `handle` and asserts it reaches the CAS — which is the
// thing that was broken, and which no fixture in the raw spelling could ever have caught.
test("CONTRACT: a directive in the DTO's spelling survives `handle`'s owner check (F-284)", async () => {
  const dto = {
    id: DID,
    // ⚠ THE AGENT-MANAGEMENT FIELDS (2026-09-01). A LAUNCH carries `kind: "launch"` and NULL on
    // both targets — which is what makes them a fair part of this fixture: the DTO emits them on
    // every row, so a `handle` that choked on their presence would break the launch lane too.
    kind: "launch",
    operatorUserId: ME,
    channelId: CH,
    threadId: TH,
    goal: "Draft the release notes",
    model: "claude-opus-5",
    templateId: null,
    templateName: null,
    targetAgentId: null,
    targetName: null,
    status: "pending",
    refusalReason: null,
    agentId: null,
    claimedAt: null,
    decidedAt: null,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    createdAt: new Date().toISOString(),
  };
  // The fixture must BE the DTO — a key the mapper emits and this object lacks means the case is
  // testing a shape the server does not send.
  for (const k of dtoKeys()) assert.ok(k in dto, `the DTO emits '${k}' and this fixture lacks it`);
  const h = boot();
  await h.api.handle(dto, WS);
  assert.equal(claimPosts(h).length, 1, "a polled row that IS this operator's must be claimed");
  assert.equal(h.cfg.lastSpec.channelId, CH);
  // ⚠ AND THE FENCE STILL HOLDS in the same spelling — carrying the field must not stop checking it.
  const other = boot();
  await other.api.handle({ ...dto, operatorUserId: "55555555-5555-4555-8555-555555555555" }, WS);
  assert.deepEqual(claimPosts(other), [], "someone else's directive is still silently dropped");
});

// ⚠ THE DTO RENAMES THE THREAD FIELD, and a row reaches `directiveFrom` by TWO roads that
// disagree about the name: a realtime frame is the raw row (`task_id`), the claim's answer is
// `service-launch.ts › toDirective`, which answers `threadId`. Missing the second would silently
// collapse every threaded directive to the CHANNEL scope — a launch on the wrong subject that
// looks like a success.
test("CONTRACT: the claimed row's `threadId` is read, not just the raw row's `task_id`", () => {
  const service = readFileSync(
    join(HERE, "..", "..", "src", "features", "channels", "server", DTO_FILE), "utf8"
  );
  assert.match(service, /threadId: row\.task_id/, "the DTO really does rename it");
  assert.equal(wire.directiveFrom({ id: DID, channel_id: CH, threadId: TH }, WS).taskId, TH);
  assert.equal(wire.directiveFrom({ id: DID, channel_id: CH, task_id: TH }, WS).taskId, TH);
});

test("CONTRACT: `decideBody` has exactly three shapes and never a fourth", () => {
  assert.deepEqual(wire.decideBody(DID, { agentId: "a1b2c3d4" }),
    { directiveId: DID, status: "launched", agentId: "a1b2c3d4" });
  // ⚠ THE NON-LAUNCH KINDS' SUCCESS (2026-09-01). It carries NO agent id — the row already NAMES
  // its target — and `launched` is deliberately not reused: this row is rendered into an
  // agent-facing sentence, and "launched" on the record of an agent being STOPPED is the one kind
  // of wrong nothing downstream can detect.
  assert.deepEqual(wire.decideBody(DID, { done: true }),
    { directiveId: DID, status: "done" });
  // ⚠ ORDER IS THE CORRECTNESS: an outcome carrying BOTH is a launch, and a `done` must never
  // fall through to the refusal tail and report a successful end as `no-bridge`.
  assert.equal(wire.decideBody(DID, { agentId: "a1b2c3d4", done: true }).status, "launched");
  assert.equal(wire.decideBody(DID, { done: false, refused: "no-session" }).status, "refused");
  assert.deepEqual(wire.decideBody(DID, { refused: "cap" }),
    { directiveId: DID, status: "refused", refusalReason: "cap" });
  // ⚠ AN EMPTY OUTCOME IS A REFUSAL, NOT A SILENCE. A claimed directive with no decision is the
  // one state the orchestrator cannot act on, so there is no way to express it.
  assert.equal(wire.decideBody(DID, {}).status, "refused");
  assert.equal(wire.decideBody(DID, null).status, "refused");
});

test("CONTRACT: a row is NARROWED, so a widened table cannot start influencing this machine", () => {
  const d = wire.directiveFrom(row({ shell_command: "rm -rf /", start_modes: { tools: "bypass" } }), WS);
  // ⚠ THREE KEYS JOINED ON 2026-09-01 (the agent-management kinds) and the LIST IS THE TEST:
  // `directiveFrom` is a literal whitelist, so this assertion is simultaneously "the new fields
  // arrive" and "nothing else does". A column the server adds and the whitelist does not name is
  // dropped without a word — which is the point of the narrowing, and also the one way to ship a
  // feature over this lane and have it do exactly nothing.
  assert.deepEqual(Object.keys(d).sort(),
    ["agentId", "channelId", "goal", "id", "kind", "model", "operatorUserId", "status",
      "targetAgentId", "targetName", "taskId", "templateId", "templateName", "workspaceId"]);
  assert.equal(d.shell_command, undefined);
  assert.equal(d.startModes, undefined);
});

// ── 2. THE TEMPLATE PAIR (2026-08-23) ────────────────────────────────────────────────────
//
// ⚠ **`directiveFrom` IS WHERE A NEW FIELD SILENTLY NEVER ARRIVES.** It is a literal whitelist,
// so a column the server adds and this function does not name is dropped without a word — which
// is the point of the narrowing and is also the one way to ship "templates over the directive
// lane" and have it do exactly nothing. Both halves get a case, and they get one EACH because
// dropping either one is a different, separately-plausible mistake.

test("TEMPLATE: `template_id` survives the narrowing, in BOTH spellings", () => {
  // ⚠ TWO ROADS, TWO NAMES. A realtime frame is the raw row (`template_id`); the CLAIM's answer
  // is the server DTO (`templateId`, `service-launch.ts › toDirective`). The module re-narrows
  // from the CLAIM, so missing the camelCase spelling would make every template launch blank —
  // a success that wears no identity.
  const TPL = "77777777-7777-4777-8777-777777777777";
  assert.equal(wire.directiveFrom(row({ template_id: TPL }), WS).templateId, TPL);
  assert.equal(wire.directiveFrom(row({ templateId: TPL }), WS).templateId, TPL);
  const service = readFileSync(
    join(HERE, "..", "..", "src", "features", "channels", "server", DTO_FILE), "utf8"
  );
  assert.match(service, /templateId: row\.template_id/, "the DTO really does rename it");
  assert.match(service, /templateName: row\.template_name/, "…and the name half with it");
});

test("TEMPLATE: `template_name` survives too, in BOTH spellings and bounded", () => {
  assert.equal(wire.directiveFrom(row({ template_name: "Code Auditor" }), WS).templateName,
    "Code Auditor");
  assert.equal(wire.directiveFrom(row({ templateName: "Code Auditor" }), WS).templateName,
    "Code Auditor");
  const long = wire.directiveFrom(row({ template_name: `a\n\tb ${"z".repeat(400)}` }), WS);
  assert.ok(long.templateName.length <= wire.TEMPLATE_NAME_MAX);
  assert.equal(long.templateName.includes("\n"), false);
});

test("TEMPLATE: a non-UUID id collapses to '' — it is about to be put in a URL path", () => {
  for (const junk of ["../../etc/passwd", "not-a-uuid", "", null, 7]) {
    assert.equal(wire.directiveFrom(row({ template_id: junk }), WS).templateId, "",
      String(junk));
  }
});

// ⚠ **E-4 — THE DELETION SIGNAL, AND IT IS THE REASON THERE ARE TWO COLUMNS.** `template_id` is
// `ON DELETE SET NULL`, so a template deleted between CREATE and CLAIM leaves the id null. On the
// id ALONE that is byte-identical to a directive that named no template — and the two get
// OPPOSITE answers (launch blank vs REFUSE). A narrowing that dropped the name whenever the id
// was empty would throw away the only evidence a template was ever named.
test("TEMPLATE: a NULLED id beside a LIVE name is preserved — that pair IS the deletion (E-4)", () => {
  const deleted = wire.directiveFrom(row({ template_id: null, template_name: "Code Auditor" }), WS);
  assert.equal(deleted.templateId, "");
  assert.equal(deleted.templateName, "Code Auditor");
  // …and "no template was ever named" is the OTHER pair, distinguishable at a glance.
  const none = wire.directiveFrom(row(), WS);
  assert.equal(none.templateId, "");
  assert.equal(none.templateName, "");
});

// ⚠ **THE NEGATIVE PIN.** `template-approval` is the desktop's answer to its OWN RENDERER when a
// FOREIGN template's first run needs one human click. There is no human at the keyboard on the
// directive lane — the launch-over-MCP toggle IS the standing consent there (Samuel, OQ-3) — so
// it must never enter this vocabulary. If it ever did, `refusalFor` would stop mapping it to
// `no-bridge` and an orchestrator would be told a first-use approval gate exists on a lane that
// has none. Driven against the SERVER's own enum too, so the two trees cannot drift into it.
test("TEMPLATE: `template-approval` is NOT a directive refusal word, on either side of the wire", () => {
  assert.equal(wire.REFUSAL_REASONS.includes("template-approval"), false);
  assert.equal(wire.refusalFor("template-approval"), "no-bridge",
    "an IPC-only word must not pass through as itself");
  assert.equal(wire.decideBody(DID, { refused: "template-approval" }).refusalReason, "no-bridge");
  const SCHEMA = readFileSync(
    join(HERE, "..", "..", "src", "features", "channels", "schema-launch.ts"), "utf8"
  );
  const enumBody = SCHEMA.slice(SCHEMA.indexOf("LaunchRefusalReasonSchema"));
  assert.equal(enumBody.slice(0, 400).includes("template-approval"), false,
    "the server's own enum must not carry it either");
});

// ⚠ THE CHECK AND THE ENUM WERE ONE WORD APART FOR A DAY, DELIBERATELY AND DANGEROUSLY: the TS
// vocabulary went to seven on 2026-08-22 while the column CHECK stayed at six, and four files
// carried a standing instruction not to ship a producer into that window — a `decide` with the
// word would have passed zod and been refused AT REST. `launch-directives.js › spawn` IS that
// producer now, so this case is what says the migration landed with it.
test("TEMPLATE: the column CHECK admits `no-template`, and the producer exists", () => {
  const MIG = join(HERE, "..", "..", "supabase", "migrations",
    "20260823140000_channel_launch_directives_template.sql");
  const sql = readFileSync(MIG, "utf8");
  assert.match(sql, /channel_launch_directives_refusal_reason_check/);
  assert.match(sql, /'no-counterparty',[\s\S]{0,900}'no-template'/,
    "the widened CHECK must list no-template beside the original six");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS template_id UUID/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS template_name TEXT/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS channel_launch_directives_template_idx/,
    "the FK cover is not optional — a template DELETE would scan the whole table");
  assert.match(SRC, /refused: 'no-template'/,
    "the producer this migration was landed for must be in launch-directives.js");
});

test("TEMPLATE: the migration NEVER touches the replica identity", () => {
  // ⚠ `REPLICA IDENTITY USING INDEX` requires its index to keep existing: drop it and the table
  // falls to replica identity NOTHING, at which point every UPDATE on a published table FAILS —
  // which here means claim and decide both stop working.
  const sql = readFileSync(join(HERE, "..", "..", "supabase", "migrations",
    "20260823140000_channel_launch_directives_template.sql"), "utf8");
  // ⚠ The DDL form only. The file's trailing assertion block READS `pg_index.indisreplident` to
  // check the identity SURVIVED, and naming it there is the opposite of touching it.
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.equal(/REPLICA IDENTITY\s+(DEFAULT|FULL|NOTHING|USING)/i.test(code), false);
  assert.equal(/DROP INDEX/i.test(code), false);
});

test("CONTRACT: an id or channel that is not a UUID is not a directive at all", () => {
  assert.equal(wire.directiveFrom(row({ id: "nope" }), WS), null);
  assert.equal(wire.directiveFrom(row({ channel_id: "../etc" }), WS), null);
  assert.equal(wire.directiveFrom(null, WS), null);
  // ⚠ A NON-UUID THREAD COLLAPSES TO THE CHANNEL SCOPE rather than being smuggled into a key.
  assert.equal(wire.directiveFrom(row({ task_id: "task-legacy-7" }), WS).taskId, "");
  assert.equal(wire.directiveFrom(row({ task_id: null }), WS).taskId, "");
});

test("CONTRACT: the goal is bounded and collapsed — it becomes fenced prompt input", () => {
  const d = wire.directiveFrom(row({ goal: `x\n\ty  ${"z".repeat(9000)}` }), WS);
  assert.ok(d.goal.length <= wire.GOAL_MAX);
  assert.equal(d.goal.includes("\n"), false);
});
