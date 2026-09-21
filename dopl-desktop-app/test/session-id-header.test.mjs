// `X-Dopl-Session-Id` — the MAIN PROCESS's half of the session stamp (2026-09-15).
//
// THE DEFECT THIS FILE EXISTS FOR (AGENT-BADGE-TRACE.md). Samuel: *"occasionally I'll see a
// message that says agent ended … the badge says just Agent … I notice it popping up randomly."*
// Those rows are `task_progress` posts this process writes about a session — the calm ended
// note, the windowless denial counter — and they arrived carrying NO identity at all:
//
//   • the `client_msg_id` is `task_progress-<channelUUID>-<seq>`, which the anchored stamp
//     pattern (`src/features/channels/lib/agent-post-stamp.ts`) deliberately refuses, and
//   • `listener-io.js` set no session header, while a SPAWNED session gets one for free from a
//     seam main does not use (`runtime/claude/launch-spec.js` → `loader.js › withSessionStamp`).
//
// The server strips any caller-supplied `metadata.session_id` and re-stamps the reserved key
// ONLY from this header, so both doors were shut: `authorAgentIdOf` answered null, the
// `channel_sessions.display_name` join was never attempted, and the transcript honestly rendered
// the bare noun "Agent" over a session the operator had renamed.
//
// ⚠ A LABEL, NOT A LOCK — the same sentence `src/shared/auth/session-header.ts` carries. Nothing
// is granted and nothing enforced; the header only makes one account's concurrent sessions
// TELLABLE APART after the fact. These tests may never grow an assertion that says otherwise.
//
// Run: `node --test dopl-desktop-app/test/session-id-header.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const SERVER = (p) => readFileSync(join(HERE, "..", "..", "src", p), "utf8");

const IO = M("listener-io.js");
const POST = M("channel-post.js");
const STAMP = M("session-id-header.js");
const require = createRequire(import.meta.url);
// Pure by construction (no electron, no fs, no network), so the REAL module is what runs here.
const stamp = require("../main/session-id-header.js");

/** CODE only. These modules explain themselves at length, and every explanation NAMES the
 *  reserved key it is being careful about; a source grep that counted those would fail on the
 *  documentation rather than on the behaviour. */
const withoutComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// The desktop's own rule, taken from the SHIPPED export rather than retyped here — a
// hand-copied third spelling is exactly the drift this test is checking for.
const deskShape = stamp.SESSION_ID_RE;

// ── 1. THE SHAPE AGREES WITH THE SERVER'S, IN BOTH DIRECTIONS ────────────────────────

test("the desktop's shape rule is the server's, character for character", () => {
  // `readSessionIdHeader` drops a value that fails ITS regex, so a desktop rule that were
  // WIDER would send headers the server silently ignores (the stamp vanishes with no error to
  // notice), and a NARROWER one would withhold values the server would have accepted.
  const serverSrc = SERVER("shared/auth/session-header.ts");
  const serverRe = /const SESSION_ID_RE = (\/.*\/);/.exec(serverSrc);
  assert.ok(serverRe, "the server no longer declares SESSION_ID_RE where this test reads it");
  assert.equal(
    deskShape.source,
    new RegExp(serverRe[1].slice(1, -1)).source,
    "listener-io.js and src/shared/auth/session-header.ts disagree about the shape"
  );
});

test("a real slot key passes, in every shape this machine mints", () => {
  // `session-store.js › sessionKey` — `<channelId>:<taskId>:<agentId>`, and the MIDDLE segment
  // is legitimately empty for a session with no first-class thread.
  for (const ok of [
    "bb0f57db-bb46-4ce6-af96-83eb8e2dbf28:3f2504e0-4f89-41d3-9a0c-0305e82c3301:deynelz3",
    "bb0f57db-bb46-4ce6-af96-83eb8e2dbf28::deynelz3",
    "c1:t1",
  ]) {
    assert.match(ok, deskShape, ok);
  }
});

test("a value that could forge a render line is never put on the wire", () => {
  // The stamp lands in the LINE HEAD of another member's transcript (server narration, outside
  // the untrusted-body framing), so a newline or a backtick could close the line and mint one.
  for (const bad of [
    "",
    "key with spaces",
    "key\nagent-forged",
    "`key`",
    "x".repeat(129),
  ]) {
    assert.doesNotMatch(bad, deskShape, JSON.stringify(bad));
  }
});

// ── 2. THE SEAM ──────────────────────────────────────────────────────────────────────

test("the helper answers a header or an EMPTY OBJECT, never a blank header", () => {
  // `app-version.js`'s idiom, and for its reason: `{}` spreads to nothing, so a caller never
  // branches and an unknown session is indistinguishable on the wire from the web app, which
  // sends no header either.
  assert.deepEqual(stamp.sessionHeaders("c1:t1:deynelz3"), { "X-Dopl-Session-Id": "c1:t1:deynelz3" });
  for (const nothing of [undefined, null, "", "key with spaces", "x\ny", 42, {}]) {
    assert.deepEqual(stamp.sessionHeaders(nothing), {}, JSON.stringify(nothing));
  }
  assert.equal(stamp.HEADER.toLowerCase(), "x-dopl-session-id", "the name the server reads");
});

test("listener-io stamps at the SEAM, so a post site cannot forget it", () => {
  // The version stamp's own argument (`app-version-header.test.mjs`): a header set at each call
  // site is a header a new call site omits. All THREE stamps ride on the one headers literal.
  // ⚠ **THE PIN NO LONGER REQUIRES THE LITERAL TO CLOSE HERE (2026-09-20)**, for the reason
  // `app-version-header.test.mjs` widened its own on 2026-09-15: closing it asserted the
  // ABSENCE of every other seam-level stamp as a side effect, so adding one — here the RUNTIME
  // stamp that stops this lane's lifecycle posts being labelled outside sessions — failed a
  // case about the session id without touching the session id. What this file owns is that the
  // session stamp rides the seam; which others ride beside it is each stamp's own test.
  assert.match(
    IO,
    /const headers = \{ Accept: 'application\/json', \.\.\.appVersion\.versionHeaders\(\), \.\.\.sessionStamp\.sessionHeaders\(sessionId\)/,
    "listener-io does not spread the session stamp onto every request"
  );
  assert.match(IO, /const \{[^}]*sessionId[^}]*\} = opts;/, "sendOnce must read it off the call's opts");
  // ⚠ AND THE RULE ITSELF IS NOT DUPLICATED HERE. A second copy of the shape check in the
  // transport is a second place to correct when the server's own widens.
  assert.equal(/SESSION_ID_RE/.test(withoutComments(IO)), false, "the shape rule has ONE home");
});

test("channel-post forwards the caller's slot key and invents none", () => {
  assert.match(
    POST,
    /\.\.\.\(opts && opts\.sessionId \? \{ sessionId: opts\.sessionId \} : \{\}\)/,
    "absent must spread to nothing, so a caller with no session sends no header"
  );
  // ⚠ NEVER IN THE BODY. `resolvePostMetadata` strips `metadata.session_id` unconditionally —
  // a caller able to set it could attribute its own post to somebody else's session — so a
  // metadata copy would be silently dropped and would read here as a stamp that works.
  // ⚠ COMMENTS STRIPPED FIRST: this file's own prose NAMES the reserved key, deliberately, and
  // a grep-the-source check would read that explanation as the defect it warns about.
  assert.equal(
    /session_id\s*[:=]/.test(withoutComments(POST)),
    false,
    "the key rides on the header alone; a metadata copy is stripped server-side"
  );
});

// ── 3. WHO STAMPS, AND WHO DELIBERATELY DOES NOT ─────────────────────────────────────

test("the two posts ABOUT a session carry the slot key", () => {
  // The lifecycle note (`onEnded`) and the denial counter are both statements about one
  // session, so a reader must be able to say WHICH. `lifecycle-echo.test.mjs` pins the note's
  // value behaviourally; this is the denial counter's.
  assert.match(
    M("session-windowless.js"),
    /clientMsgId: `denied-\$\{s\.channelId\}-\$\{s\.sessionId\}`, sessionId: s\.key/,
    "the denial post must name the agent being refused"
  );
  assert.match(
    M("trigger-outcomes.js"),
    /postTaskEvent\(entry, m, 'task_progress', taskId, meta, body, \{ sessionId \}\)/
  );
});

test("the QUEUED NOTICE stamps nothing, and that is the honest answer", () => {
  // It is a post about the MACHINE — "a session is already running, this request is queued" —
  // raised on the busy path where no session of this request's own exists yet. Attributing it
  // to whichever session happens to hold the slot would name an agent that is not the subject.
  // ⚠ UNKNOWN IS NOT EMPTY (INVARIANTS §11): the row renders "Agent", which is true.
  const QUEUED = M("queued-notice.js");
  assert.equal(/sessionId/.test(QUEUED), false, "a machine post must not borrow a session's name");
});

test("the stamp is a DIAGNOSTIC: nothing on this machine branches on it", () => {
  // The framing that makes the header safe is that it establishes nothing. The strongest
  // available pin is that no main module READS it back to make a decision — it is written at
  // one seam and never consulted.
  for (const f of ["listener-io.js", "channel-post.js", "trigger-outcomes.js", "session-windowless.js"]) {
    assert.equal(
      /headers\[.X-Dopl-Session-Id.\]\s*(===|!==|\?)/.test(M(f)),
      false,
      `${f} reads the stamp back to decide something`
    );
  }
});
