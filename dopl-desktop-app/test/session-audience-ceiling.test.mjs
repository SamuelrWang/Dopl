// THE AUDIENCE CEILING ON THE DESKTOP — layers B2 (the grant belt) and B1's desktop half (the
// container-locked credential), plan §4.4.
//
// ⚠ IT DRIVES THE REAL `grantDecision`, not a re-implementation. `session-profiles.js`'s
// BEGIN/END SESSION-PROFILE TABLE block is sliced and evaluated with the SHIPPED predicates
// injected — the same idiom `sdk-grant.test.mjs` and `session-profiles.test.mjs` use, and for the
// same reason: a harness with its own copy of the rules agrees with itself while production does
// something else.
//
// 🔒 ⚠ EVERYTHING PINNED HERE IS A TRIPWIRE, AND A GREEN RUN IS NOT CONTAINMENT. A `full` profile
// has Bash and the operator's 90-day device token is on disk, so an agent can issue the same call
// as plain HTTP and never reach `canUseTool` at all. The FENCES are elsewhere and both are outside
// this process: the locked credential (`with-workspace-auth.ts`'s 403) and the server-side
// audience ceiling (`knowledge/server/service-audience.ts`'s 404). What these assertions protect
// is that a WELL-BEHAVED agent is stopped early and the operator can SEE it being stopped.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const M = (f) => join(HERE, "..", "main", f);

const PROFILES = require_(M("session-profiles.js"));
const AUDIENCE = require_(M("session-audience.js"));
const { GATE_REASONS } = require_(M("session-gate-reason.js"));

const CONTAINER = "ws-container";
const OTHER = "ws-home";
const KB = "mcp__dopl__dopl_kb";
const SEARCH = "mcp__dopl__dopl_search";

/** A locked session's grant args, shaped exactly as `session-io.js › grantArgs` builds them. */
const locked = (over) => ({
  profile: "full",
  channelId: "c1",
  workspaceId: CONTAINER,
  audience: "container-only",
  toolMode: "bypass",
  messageMode: "auto_both",
  allowForTask: [],
  ...over,
});

// ── the pure predicate ──────────────────────────────────────────────────────

test("audienceFor: a SHARED container is container-only; a SOLO one is not", () => {
  assert.equal(AUDIENCE.audienceFor({ kind: "link", memberCount: 2 }), "container-only");
  // ⚠ The solo case is the operator's own primary agent surface and every layer of the ceiling
  // leaves it alone. Narrowing it would break the daily path to protect an audience of one
  // person who is the operator.
  assert.equal(AUDIENCE.audienceFor({ kind: "link", memberCount: 1 }), null);
  assert.equal(AUDIENCE.audienceFor({ kind: "standard", memberCount: 9 }), null);
  assert.equal(AUDIENCE.audienceFor(null), null);
});

test("🔒 audienceFor: an ABSENT memberCount is container-only — unknown is not solo", () => {
  // §8's stale-cached-field rule, INVERTED on purpose: the field is new on GET /api/workspaces,
  // and the reflex fallback would disarm the belt for a whole release window.
  assert.equal(AUDIENCE.audienceFor({ kind: "link" }), "container-only");
});

test("audienceFor: an ABSENT kind reads as STANDARD — the OPPOSITE default, and deliberately", () => {
  // Unknown KIND = probably not a container at all (§4A's positive predicate).
  // Unknown COUNT = a real container whose roster we could not read. Different questions.
  assert.equal(AUDIENCE.audienceFor({ memberCount: 5 }), null);
});

test("containerOnlyDenies FAILS OPEN on everything it cannot read", () => {
  const isDopl = () => true;
  // No audience at all — an ordinary session.
  assert.equal(AUDIENCE.containerOnlyDenies({ workspaceId: CONTAINER, input: { workspace: OTHER } }, isDopl), false);
  // No `workspace` argument = the session default, which under a lock IS the container.
  assert.equal(AUDIENCE.containerOnlyDenies(locked({ input: { op: "read" } }), isDopl), false);
  // A non-string, a blank, a missing input, a container we do not know.
  assert.equal(AUDIENCE.containerOnlyDenies(locked({ input: { workspace: 7 } }), isDopl), false);
  assert.equal(AUDIENCE.containerOnlyDenies(locked({ input: { workspace: "  " } }), isDopl), false);
  assert.equal(AUDIENCE.containerOnlyDenies(locked({ input: null }), isDopl), false);
  assert.equal(AUDIENCE.containerOnlyDenies(locked({ workspaceId: "", input: { workspace: OTHER } }), isDopl), false);
  // A NON-dopl tool whose `workspace` means something else entirely.
  assert.equal(AUDIENCE.containerOnlyDenies(locked({ input: { workspace: OTHER } }), () => false), false);
});

test("containerOnlyDenies fires on a dopl call addressed at ANOTHER workspace", () => {
  assert.equal(AUDIENCE.containerOnlyDenies(locked({ input: { workspace: OTHER } }), () => true), true);
  // ...and never on the container itself, whitespace included.
  assert.equal(AUDIENCE.containerOnlyDenies(locked({ input: { workspace: CONTAINER } }), () => true), false);
  assert.equal(AUDIENCE.containerOnlyDenies(locked({ input: { workspace: ` ${CONTAINER} ` } }), () => true), false);
});

// ── the REAL grantDecision ──────────────────────────────────────────────────

test("🔒 the REAL grantDecision denies a cross-workspace dopl call on a locked session", () => {
  const v = PROFILES.grantDecision(locked({ toolName: KB, input: { op: "read", workspace: OTHER } }));
  assert.equal(v, "deny");
});

test("🔒 ...and it covers `dopl_search`, which `preApproved` would have SHADOWED", () => {
  // THE REASON STEP 1.5 IS AHEAD OF `preApproved`. A pre-approved tool is shadowed by the SDK's
  // `allowedTools` and never reaches canUseTool, so a check placed after it is a check that
  // never runs for the read tools an agent uses most.
  const cfg = PROFILES.buildSessionToolConfig("dopl_only");
  assert.ok(cfg.preApproved.includes(SEARCH), "the premise: dopl_search IS pre-approved here");
  const v = PROFILES.grantDecision(
    locked({ profile: "dopl_only", toolName: SEARCH, input: { query: "x", workspace: OTHER } })
  );
  assert.equal(v, "deny", "the belt must beat the pre-approval, or it never fires on a read");
});

test("the SAME call at the container is untouched — the belt only ever narrows", () => {
  const v = PROFILES.grantDecision(
    locked({ profile: "dopl_only", toolName: SEARCH, input: { query: "x", workspace: CONTAINER } })
  );
  assert.equal(v, "preapproved");
});

test("an UNLOCKED session is completely unaffected — no regression", () => {
  const v = PROFILES.grantDecision(
    locked({ audience: null, profile: "dopl_only", toolName: SEARCH, input: { query: "x", workspace: OTHER } })
  );
  assert.equal(v, "preapproved");
});

test("a HARD-DENIED tool stays hard-denied — step 1 still runs first", () => {
  // The order matters for the EXPLANATION, not the verdict: both deny, and an operator sent to
  // the wrong setting cannot act on either.
  const admin = "mcp__dopl__dopl_kb_admin";
  const d = PROFILES.grantDecisionDetail(locked({ toolName: admin, input: { op: "x", workspace: OTHER } }));
  assert.equal(d.decision, "deny");
  assert.equal(d.reason, "hard-denied");
});

test("🔒 the denial is EXPLAINABLE — its own gateReason code, in the closed set", () => {
  const d = PROFILES.grantDecisionDetail(locked({ toolName: KB, input: { op: "read", workspace: OTHER } }));
  assert.equal(d.decision, "deny");
  assert.equal(d.reason, "container-audience");
  assert.ok(GATE_REASONS.includes("container-audience"), "the code is in the closed set");
});

// ── B1's desktop half: which sessions get a locked credential ───────────────

test("shouldLockSession agrees with audienceFor, exactly", () => {
  // ⚠ TWO PREDICATES, ONE RULE. They live in different modules because one decides a CREDENTIAL
  // and the other decides a GATE, and they are asserted equal here so a change to either is
  // caught rather than discovered as a session that is locked but not belted (or the reverse).
  const CREDENTIAL = require_(M("session-credential.js"));
  for (const ws of [
    { kind: "link", memberCount: 2 },
    { kind: "link", memberCount: 1 },
    { kind: "link" },
    { kind: "standard", memberCount: 3 },
    { memberCount: 2 },
    null,
  ]) {
    assert.equal(
      CREDENTIAL.shouldLockSession(ws),
      AUDIENCE.audienceFor(ws) === "container-only",
      `disagreement on ${JSON.stringify(ws)}`
    );
  }
});

test("sessionBearer answers '' for an unlocked session and the token for a locked one", () => {
  const CREDENTIAL = require_(M("session-credential.js"));
  assert.equal(CREDENTIAL.sessionBearer({}), "");
  assert.equal(CREDENTIAL.sessionBearer(null), "");
  assert.equal(CREDENTIAL.sessionBearer({ containerToken: { token: "dopl_at_x" } }), "dopl_at_x");
});

// ── the wiring, pinned by source scan ───────────────────────────────────────

test("🔒 BOTH query-start sites mint the credential — neither may be dropped", () => {
  // There are exactly two places a query starts, and a woken SPAWN-IDLE shell only ever reaches
  // the second. A single site would leave a whole spawn shape on the unlocked device token, and
  // nothing else in this suite would notice.
  for (const f of ["session-query.js", "session-park.js"]) {
    const src = readFileSync(M(f), "utf8");
    assert.match(
      src,
      /sessionCredential\.ensureContainerCredential\(s, diag\)/,
      `${f} must mint the container credential before it assembles options`
    );
  }
});

test("🔒 the credential is RELEASED at settle and NOT at park", () => {
  const teardown = readFileSync(M("session-teardown.js"), "utf8");
  assert.match(teardown, /releaseContainerCredential\(s, diag\)/, "settle gives the credential back");
  // ⚠ Park must NOT: `resumeParked` re-enters `buildSdkOptions` on the SAME object, so a released
  // credential would come back as a session that 401s on its first tool call with nothing to say
  // why. The 24h TTL is the backstop for a settle that never runs.
  const park = readFileSync(M("session-park.js"), "utf8");
  assert.ok(
    !/releaseContainerCredential/.test(park),
    "park must never release the credential — a resume needs it back"
  );
});

test("🔒 buildSdkOptions passes the session bearer into buildMcpServers", () => {
  const query = readFileSync(M("session-query.js"), "utf8");
  assert.match(
    query,
    /buildMcpServers\(cfg\.doplToolsPolicy, s\.workspaceId, sessionCredential\.sessionBearer\(s\)\)/,
    "dropping the third argument silently reverts every locked session to the device token"
  );
});

test("🔒 the audience is STAMPED, and BEFORE the mint — so a failed mint still belts", () => {
  // The credential and the belt are independent layers that share one workspace read. Stamping
  // after a successful mint would disarm B2 on exactly the runs where B1 could not be minted —
  // i.e. wherever the fence is already weakest. Pinned by ORDER, not just presence.
  const src = readFileSync(M("session-credential.js"), "utf8");
  const stamp = src.indexOf("s.audience = 'container-only'");
  const mint = src.indexOf("apiFetch(MINT_PATH");
  assert.ok(stamp !== -1, "session-credential must stamp the audience");
  assert.ok(mint !== -1 && stamp < mint, "the stamp must come BEFORE the mint");
});

test("🔒 grantArgs carries the audience, so the PREDICTION and the GATE agree", () => {
  // `session-io.js › grantArgs` is the ONE argument builder both `postWillGate` and the real
  // `canUseTool` use. An audience read at a call site instead would let the two disagree about
  // the same call.
  const io = readFileSync(M("session-io.js"), "utf8");
  assert.match(io, /audience: s\.audience \|\| null/);
  assert.match(io, /workspaceId: s\.workspaceId/);
});
