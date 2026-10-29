// Session dispatch — the listener's pre-classify routing.
//
// ONE ROUTE: `feedLiveSession`, the delivery lane. It claims nothing into existence; a live
// session's own existence is the gate. (Four requester/reopen routes were deleted with the
// window machinery, 2026-08-20, F-228.)
//
// ── THE FAN-OUT IS NARROWED TO THE ADDRESSED RECIPIENT (2026-09-02, ruling B1) ─────────────
//
// ⚠ THIS REVERSES SAMUEL'S RULING 4 OF 2026-08-21 — *"every message in a thread feeds every
// live agent on it"* — AND THE REVERSAL IS THE WHOLE OF THIS ROUTE NOW. Ruling 4 was right for a
// machine that had no other answer: WHO a message was for was re-derived here, by every desktop
// in the field, so the only safe reading of an unaddressed post was "everybody on the thread".
//
// ⚠ **WHO A MESSAGE IS FOR IS NOW DECIDED ONCE, ON THE SERVER, AT WRITE TIME** — INVARIANTS §5,
// THE DELIVERY KEYSTONE. `src/features/channels/server/service-wake-verdict.ts` stores
// `wake_verdict` plus `recipient_user_ids` / `recipient_agent_ids` on the row, and this machine
// EXECUTES that answer rather than re-deriving one. The seven verdicts route as follows:
//
//   agent · responder     the named agent ids. They are FED and they are WOKEN.
//   thread_peer            the THREAD's other party. If that is this operator, their sessions on
//                          that thread hear it as context and none is woken.
//   member                 a PERSON the author NAMED. Fed as context only when a PERSON wrote it
//                          (see the block below); an AGENT addressing a person reaches no agent.
//   thread                 no recipient, but a thread tag: the sessions already working that
//                          thread hear it and nobody is woken.
//   reciprocal             NOBODY. 🔴 RR2 is DELETED server-side (2026-09-18) so nothing produces
//                          it; an OLD ROW carrying it is read here and fed to nobody.
//   none                   nobody — which is every RECORD (`kind="record"`).
//
// ⚠ **TWO RESILIENCE ARMS MAKE THE NARROWING SAFE** (RR1/RR3, INVARIANTS §5): a forgotten `@`
// from a PERSON must never stall a conversation, so the SERVER repairs that address once at
// write time and nothing here repairs one.
//
// ⚠ **AND THE FALLBACK IS THE WHOLE COMPATIBILITY STORY. TWO CAUSES, ONE FACT: THE SERVER DID
// NOT ANSWER.**
//   • NO `wakeVerdict` AT ALL — a build older than `20260912120000`, or a row written before it.
//     This machine parses the body itself and fans out exactly as it did on 2026-08-21: ruling 4,
//     kept intact for as long as a server can still speak the old shape.
//   • A verdict WITH `recipientAgentIds: null` — handles were named and the server could not
//     resolve them (a PEER's agent, minted on their machine and known to no server; or a
//     projection row not yet pushed). The body parse answers for the agent half ONLY. `[]` is an
//     ANSWER — "this body names no agent" — and is executed, never re-derived; collapsing `null`
//     and `[]` silences a live agent, the one failure this seam exists to prevent.
//
// ── THE LOOP FENCE IS ONE PREDICATE NOW (2026-09-02) ───────────────────────────────────────
//
// FOUR BRAKES ON "WHO WAKES":
//   • a non-`message` kind reaches no session at all (the `kind` filter below);
//   • an AUTHORLESS row reaches nothing — a system row, nobody spoke;
//   • a session is never fed its OWN post (`wroteIt` + `authoredBySession`);
//   • `mayWake` below (the 2026-08-31 SAME-ACCOUNT CARVE): redundant under a stored verdict,
//     load-bearing under the fallback. One predicate right in both places beats two spellings.
// There is no LLM triage tier (deleted, ruling B6): the server's RR3 answers who an unaddressed
// human message meant, and the @-mention is the `agent` verdict.
//
// ── THE SPAWN-IDLE WAKE RULE (2026-08-22, Samuel's ruling) ────────────────────────────────
//
// ⚠ ONE CLASS OF SESSION IS EXEMPT FROM DELIVERY UNTIL SOMEBODY DIRECTS IT. A SPAWN-IDLE agent
// (`sessions:launch` with `idle: true` — the New Agent button) is REGISTERED and has started no
// `claude` child at all: it holds a slot, a pill and an @-mention address, and `wakeEffects`
// starts its query on the first fed turn. So an unwoken spawn-idle session is fed NOTHING unless
// this message WAKES it — an address, not an overhearing. Everything else is DROPPED, not queued:
// the agent reads the thread ON DEMAND once directed, and that read costs no permission
// (`session-profiles.js › isOwnChannelRead`), so nothing is lost by not pushing it.
//
// ⚠ THE FLAG IS ITS OWN (`s.awaitingDirective`), NOT AN OVERLOAD OF `freshFraming`: that marker
// answers "does this turn carry the full framing" and is one-shot; this answers "may anything
// reach this agent yet" and is cleared by the WAKE, at the engine's single dispatch funnel.
//
// ⚠ AND IT IS BELT-AND-BRACES: `session-gate.js › feedInbound` refuses the same message again.
const targeting = require('./targeting');
const io = require('./listener-io');
const sessionEngine = require('./session-engine');
const agentHandles = require('./agent-handles');
// THE RECEIPT BUFFER (2026-09-02, A9) and the ROOM-ROSTER note (2026-09-18). Above the sentinel like every other dep, so the extracted block reaches each as a free var and the truth tables can inject a fake.
const deliveryAck = require('./delivery-ack');
const { diag } = require('./diag');
const { agentAuthorNote, authorAddress } = require('./room-roster');
const dispatchScope = require('./session-dispatch-scope'); // off-scope addressees (2026-10-29)
// ─── BEGIN SESSION-DISPATCH-PURE (routing; unit-tested via source extraction) ──

// ⚠ THE SERVER'S OWN VOCABULARY, RESTATED — `src/features/channels/types-delivery.ts ›
// ChannelWakeVerdict`. A word this build does not know reads as NO ANSWER and takes the
// fallback, which is the same direction an absent column takes: a newer server may add a
// verdict, and an installed desktop must degrade to today's behaviour rather than to silence.
const VERDICTS = ['none', 'member', 'agent', 'thread', 'thread_peer', 'reciprocal', 'responder'];

// ── AN AGENT SESSION TAKES A TURN ONLY WHEN IT IS ADDRESSED (2026-09-18, Samuel's ruling) ───
//
// *"Agents should only be woken up when addressed (besides the logic for a user with no @ in
// their message)."* THREE THINGS COUNT AS ADDRESSED, and there is no fourth:
//   • named in `to` — `recipientAgentIds`, executed by `serverAddressed`;
//   • the OTHER PARTY OF A TWO-PARTY THREAD — `thread_peer`, and `thread` for the sessions
//     already working that thread. Both are thread-scoped by `liveOnThread`'s key;
//   • the structured ESCALATION-ANSWER field, which names the agent that ASKED.
//
// ⚠ **SO A MEMBER RECIPIENT FEEDS NOTHING WHEN AN AGENT WROTE THE POST.** An agent addressing a
// PERSON is asking for a person: they are notified, an external held read sees it, and their
// channel agents get no turn. This was the second half of the wake-all report — the first was
// `reciprocal`, RR2's repair of an unaddressed agent post back to the operator, which is DELETED
// server-side now and inert here for old rows. A main-room post keys `liveOnThread`
// `<channel>::`, so "context" there is every main-room session of that operator, one full model
// turn each; there is no passive-context lane (a windowless session floors at `auto_inbound`).
//
// ⚠ **A PERSON'S `to=<me>` STILL FEEDS** — the one case where my side decides what runs.
// ⚠ **`reciprocal` FALLS THROUGH TO FALSE** rather than being listed and excluded, which is what
// keeps this machine safe against a server that predates the deletion.

// WHO WROTE THIS MESSAGE, for the wrapper a session is fed it inside.
// ⚠ `io.displayNameFor` names the ACCOUNT a post came from, and a peer's AGENT posts from the
// peer's account — so "<name> posted in the channel…" credits a person for a machine's words.
// `author_kind` tells the two apart and is derived server-side from the caller's credential,
// never claimed on the wire.
// ⚠ Inside the PURE block on purpose: the truth tables slice this block whole and drive the
// real routes, so a helper the routes call must be sliced with them.
function authorLabel(m) {
  const person = String((io.displayNameFor(m && m.authorUserId)) || '').trim();
  if (!(m && m.authorKind === 'agent')) return person;
  return person ? person + "'s agent" : 'an agent';
}


// The verdict the server stored, or '' when it stored none this build understands.
function storedVerdict(m) {
  const v = String((m && m.wakeVerdict) || '');
  return VERDICTS.indexOf(v) === -1 ? '' : v;
}

// The agent ids the server resolved — ONE OR SEVERAL — intersected with the sessions live here.
//
// ⚠ **ABSENT IS NOT EMPTY.** An ARRAY — EMPTY INCLUDED — is the server's authoritative answer
// and the body parse is not run at all; `null` is "not resolved there" and falls through to the
// parse, which is today's behaviour exactly. `??` and never `||` at the call site.
// ⚠ **STILL INTERSECTED WITH `liveIds`**, and DE-DUPED: `liveIds` is this post's scope; a named
// agent working ANOTHER scope is `session-dispatch-scope.js`'s, fed by `feedLiveSession` below.
function serverAddressed(m, liveIds) {
  const ids = m && m.recipientAgentIds;
  if (!Array.isArray(ids)) return null;
  const out = [];
  for (const raw of ids) {
    const id = String(raw || '');
    if (liveIds.indexOf(id) !== -1 && out.indexOf(id) === -1) out.push(id);
  }
  return out;
}

// TRUE iff the server named THIS operator as a recipient of the message.
// ⚠ THE SAME THREE-ANSWER READ AS THE AGENT HALF: a non-array is "not resolved here" and names
// nobody, which is what an older row and a lifecycle marker both carry.
function serverNamesMember(m, myUserId) {
  const ids = m && m.recipientUserIds;
  const me = String(myUserId || '');
  return !!me && Array.isArray(ids) && ids.indexOf(me) !== -1;
}

// THE @AGENT-ID PARSER, AND WHY IT LIVES ON THIS MACHINE (2026-08-21, ruling 5).
//
// ⚠ **A PERSON'S DOOR ONLY SINCE 2026-09-18** — an agent's prose names nobody (see `planFor`).
//
// ⚠ IT MUST NEVER BECOME A SERVER READ. `metadata.mentionedUserIds` is the server's stamped,
// unspoofable mention set, resolved against the channel ROSTER — and an agent id is not a
// member, so that resolver correctly answers "nobody". That fail-closed behaviour is right and
// stays: a caller-settable mention set is a notification-forgery primitive, and agent ids are
// minted per machine and known to no server. So the parse happens HERE, where the live agent
// ids are — and since 2026-09-02 it runs ONLY where the server declined to answer.
//
// The pattern is `agent-id.js`'s charset with a word boundary, and the result is INTERSECTED
// with the ids actually live on this thread — so `@deadbeef` in prose resolves to nothing, and
// a peer cannot address an agent that is not mine because they cannot know its id.
//
// ⚠ THE `agent-` PREFIX IS ACCEPTED SINCE 2026-08-27 (Samuel's handle-convention ruling). The
// web tree WRITES and TINTS `@agent-<id>` (`src/features/channels/lib/agent-mentions.ts`) and
// the bare `@<id>` form is what older messages carry, so both resolve and the prefix is optional
// rather than a second regex. **A convention change that only moved the renderer would have
// rendered a blue token this parser ignored** — the tint-says-tagged / stamp-says-nobody defect
// F-266 already cost a wave to fix once.
//
// ⚠ THE NEGATIVE LOOKBEHIND IS WHAT KEEPS THE TWO FORMS FROM OVERLAPPING. Without it the bare-id
// alternative would ALSO match inside `@agent-k3v7d2mq` — `-` is a non-word character, so a plain
// boundary sees `k3v7d2mq` there — and a single mention would resolve twice. It is harmless today
// (`out` de-dupes) and would stop being the moment anything counted matches.
//
// ⚠ AND SLUGGED CUSTOM NAMES SINCE 2026-08-28 (Samuel's F-350 ruling: "the parser learns names").
// `@research-bot` reaches the agent its operator renamed "Research Bot", because the picker
// INSERTS that form (`lib/agent-mentions.ts › agentMentionHandle` prefers the slug over the id)
// and the transcript TINTS it. The slug rule, the token strip and the ambiguity fence live in
// `agent-handles.js`; what belongs HERE is that there are TWO DOORS and how they compose:
//
//   • THE ID DOOR is this regex, intersected with `liveIds`. Unambiguous by construction, never
//     withdrawn, and still the handle that reaches an agent whose NAME is contested.
//   • THE NAME DOOR is `handleIndex`, which its builder has ALREADY intersected with the same
//     roster. Absent or empty ⇒ this behaves exactly as it did before the ruling, which is what
//     keeps every caller that does not pass one honest rather than silently degraded.
//
// ⚠ THE ORDER IS ID-FIRST AND IT IS NOT COSMETIC. `out` is the addressee list and the framing
// prints it: an id is the address a peer was handed; a slug is one this machine resolved
// locally, so the exact address sorts ahead of the friendly one.
// ⚠ NEITHER DOOR LOOSENS THE REFUSAL. An unknown slug, an ambiguous slug and an unknown id all
// contribute nothing, and a message that names nobody still wakes nobody.
function mentionedAgentIds(body, liveIds, handleIndex) {
  const out = [];
  if (!liveIds || !liveIds.length) return out;
  const text = String(body == null ? '' : body);
  const re = new RegExp('(?<![a-z0-9-])@(?:agent-)?([a-z][a-z0-9]{7})(?![a-z0-9-])', 'g');
  let hit = re.exec(text);
  while (hit) {
    const id = hit[1];
    if (liveIds.indexOf(id) !== -1 && out.indexOf(id) === -1) out.push(id);
    hit = re.exec(text);
  }
  for (const id of agentHandles.slugMentionedAgentIds(text, handleIndex)) {
    if (liveIds.indexOf(id) !== -1 && out.indexOf(id) === -1) out.push(id);
  }
  return out;
}

// ⚠ THE ESCALATION-ANSWER DOOR MOVED TO `agent-handles-escalation.js` (§2 SPLIT, 2026-09-14,
// the 500-line cap) and is re-exported by `agent-handles.js`. Bound under its own name here
// because `planFor` reads it beside the handle parse; that file carries the whole argument.
const escalationAnswerAgentIds = agentHandles.escalationAnswerAgentIds;

/**
 * THE DELIVERY PLAN FOR ONE MESSAGE, ON THIS MACHINE.
 *
 *   ids      the agent sessions this message is FOR. Fed, and woken if dormant.
 *   context  feed every OTHER live session on the thread, waking none of them.
 *
 * ⚠ **`context` IS NOT A SECOND FAN-OUT.** It is true in exactly three situations, each the
 * server having said "this reaches the thread and wakes nobody": the `thread` verdict; a
 * `thread_peer` or a PERSON-authored `member` naming this operator; and the OLD-SERVER
 * fallback, which is ruling 4 preserved whole. Everything else — an AGENT addressing a person,
 * a message for a peer, a record, `reciprocal` — feeds nothing at all.
 */
// ⚠ THE BODY PARSE RUNS ONLY ON A ROW NO SERVER EVER RULED ON (2026-09-07). It used to run
// whenever `recipientAgentIds` was absent, and that quietly unbought the CODE AND MARKUP MASKS:
// the server reads handles through `mentionTokensOf`, which masks them (`lib/mentions.ts` rules
// 6 and 7 — code is quoted text and tags NOBODY, bought after two agents documenting @-tagging
// put backticked handles in their bodies and tagged both operators for real, seqs 647 / 653,
// 2026-08-21), and `mentionedAgentIds` above masks nothing. A body quoting one live handle and
// naming one dead one made the server answer `null`, fell through to the unmasked regex, and
// woke the fenced agent — ordinary traffic, not a contrived shape.
//
// ⚠ AND NO, DO NOT PORT THE MASKS INTO THIS TREE — that is the drift `lib/mentions.ts` spends
// its header forbidding, the original defect (a private copy of the token rule) in a new place.
// A row the server ruled on is already masked, authoritatively, by the one parser.
// ⚠ THE DISTINCTION IS `wakeVerdict`: "this build stored no verdict" (`storedVerdict` answers
// '') and "the server ran and named nobody" are different facts, and only the first justifies
// the fallback. ⚠ WHAT IT TRADES: `null` means "you decide", not "nobody" — the token may name an
// agent whose session row has not been PUSHED yet — and that case now goes unfed on a
// verdict-bearing row. The smaller harm: an unwoken agent is visible and retryable, a code fence
// that wakes one is neither. Pinned both ways in `test/session-dispatch-mask-fallback.test.mjs`.
// ⚠ **AN AGENT'S PROSE IS NOT AN ADDRESS ON THIS MACHINE EITHER** (2026-09-18, cause 2 of the
// wake-all report): a report saying *"I handed off to @sonnet-reader"* woke that agent off the
// sentence DESCRIBING the handoff, because the parse never asked who was writing. The server
// answers `[]` for an agent author's body on every row it rules on; this closes the one row it
// never ruled on. An agent that means an agent says so in `to=`, which takes a list.
// ⚠ IT DOES NOT TOUCH `escalationAnswerAgentIds` — a SERVER-STAMPED structured field naming the
// agent that ASKED, not a handle somebody typed.
function planFor(m, liveIds, myUserId) {
  const verdict = storedVerdict(m);
  const resolved = serverAddressed(m, liveIds);
  const agentAuthored = !!(m && m.authorKind === 'agent');
  const ids =
    resolved ??
    (verdict === '' && !agentAuthored
      ? mentionedAgentIds(m.body, liveIds, agentHandles.handleIndexFor(liveIds))
      : []);
  for (const id of escalationAnswerAgentIds(m, liveIds)) {
    if (ids.indexOf(id) === -1) ids.push(id);
  }
  if (!verdict) return { ids: ids, context: true }; // no answer stored: ruling 4, unchanged
  if (ids.length) return { ids: ids, context: false }; // narrowed to whoever was named
  // `thread_peer` is the THREAD's own two-party address, so it feeds whoever wrote it;
  // `member` is an address to a PERSON and feeds this operator's agents only when a PERSON
  // wrote it. Every other verdict — `reciprocal` included — feeds nobody.
  const forMe =
    serverNamesMember(m, myUserId) &&
    (verdict === 'thread_peer' || (verdict === 'member' && !agentAuthored));
  return { ids: ids, context: verdict === 'thread' || forMe };
}

// The ADDRESSING verdict for one reader, handed to the framing.
//   null                       nobody was addressed — an ordinary thread message
//   { me: true,  ids: [...] }  this agent is one of the addressees
//   { me: false, ids: [...] }  somebody else's agent was addressed; read it as context only
// ⚠ THE THIRD SHAPE IS REACHABLE ONLY ON THE OLD-SERVER FALLBACK NOW. Under a stored verdict a
// session that was not named is not fed at all, so nobody pays for a line telling them to stand
// down; `session-seed.js › addressingLines` keeps its `me: false` lines for that fallback.
function addressingFor(myAgentId, addressed) {
  if (!addressed || !addressed.length) return null;
  return { me: addressed.indexOf(String(myAgentId || '')) !== -1, ids: addressed };
}

// TRUE iff this session is the one that WROTE this message (by `client_msg_id`); the feed also
// excludes {@link authoredBySession}.
function wroteIt(s, m) {
  const id = m && m.clientMsgId;
  if (!id || !s || !s.ownPostIds) return false;
  return s.ownPostIds.has(String(id));
}

// THE SAME QUESTION, ASKED OF THE SERVER'S STAMP — `metadata.session_id`, whose value IS this
// machine's slot key (`session-store.js › sessionKey`; the server re-stamps it from
// `X-Dopl-Session-Id` and strips any caller copy).
//
// ⚠ **IT EXISTS BECAUSE {@link wroteIt} HAS A HOLE AND THE HOLE IS BY DESIGN** (2026-09-04, the
// Mobile Command Center incident). `ownPostIds` holds the stamps this machine MINTS, and
// `session-outbound-tag.js › threadTagFor` deliberately NEVER OVERWRITES a `client_msg_id` an
// agent supplied — so a session that passes its own idempotency key posts a row whose id this
// machine never recorded, `wroteIt` answers false, and the session is fed its own words back.
// Three turns of a 1M-context session went that way in one four-minute stretch.
// ⚠ **A SECOND KEY, NOT A REPLACEMENT** — `client_msg_id` answers first (rows predate the
// stamp); this answers for everything that supplied its own. ⚠ **AND THE BELT UNDER THE SERVER'S
// BRACE**: the verdict drops the author's own session before storing a recipient, but a stored
// verdict is only as new as the server and the fallback has no such structure.
function authoredBySession(s, m) {
  const meta = m && m.metadata;
  const stamped = meta && typeof meta === 'object' ? meta.session_id : null;
  if (typeof stamped !== 'string' || !stamped) return false;
  const key = String((s && s.key) || '');
  return !!key && key === stamped;
}

// TRUE iff this session is a SPAWN-IDLE agent nobody has directed yet. ⚠ `=== true` ONLY, so a
// session object that predates the flag — or any shape that simply does not carry it — keeps the
// plain feed behaviour. A wake rule that fails toward "feed it" is the safe direction here:
// the failure it guards is a wasted launch, not a leak.
function unwoken(s) {
  return !!(s && s.awaitingDirective === true);
}

// TRUE iff NO `claude` query is running for this agent right now — the class a wake starts.
// Two shapes, and they are genuinely different states that answer this one question the same way:
//   • a SPAWN-IDLE shell that never started a query (`awaitingDirective`)
//   • a session an idle park tore the query down for (`state.parked`), which a fed turn RESUMES
//     (`session-reducer.js › wakeEffects` -> `resumeQuery` -> `session-park.js › resumeParked`)
// ⚠ `=== true` ON BOTH, same reason as `unwoken`: an unfamiliar session shape keeps the feed.
function dormant(s) {
  if (unwoken(s)) return true;
  return !!(s && s.state && s.state.parked === true);
}

// May this message reach this session at all? The feed's ONE hold-back.
//
// ⚠ IT TAKES THE WAKE VERDICT, IT DOES NOT DERIVE ONE. `wake` is the decision already made for
// THIS message and THIS agent by `feedLiveSession` below, and it is the ONLY door for a dormant
// session.
// ⚠ FAIL TOWARD FEEDING FOR AN UNKNOWN SHAPE, unchanged: a session object that carries neither
// flag is not dormant and is fed whatever the plan sends it.
function mayFeed(s, wake) {
  if (!dormant(s)) return true;
  return wake === true;
}

/**
 * THE SAME-ACCOUNT CARVE (2026-08-31, Samuel's ruling) — and it is all that is left of the loop
 * fence's three-string enum.
 *
 * An AGENT-authored message may wake a dormant agent only when its author is **this machine's
 * signed-in operator**. A PEER's agent starts nothing here (the 2026-08-28 ruling, unchanged);
 * the operator's own agents may address each other, which is what makes a launched agent a
 * capability rather than an id nobody can spend.
 *
 * ⚠ **REDUNDANT UNDER A STORED VERDICT, LOAD-BEARING UNDER THE FALLBACK.** The server resolves
 * an agent recipient against the AUTHOR'S OWN sessions, so no stored verdict can name a peer's
 * agent; the fallback has no such structure and this is its fence.
 * ⚠ FAILS CLOSED ON THE IDENTITY: a blank or unknown operator id can never equal a non-blank
 * author id, so the comparison needs no second branch.
 * ⚠ IT GATES THE **WAKE** AND NEVER THE FEED. An agent-authored message still reaches a session
 * that is already RUNNING — that is how two of my agents coordinate.
 */
function mayWake(m, myUserId) {
  return !m || m.authorKind !== 'agent' || fromMe(m, myUserId);
}

const fromMe = (m, myUserId) => !!myUserId && String(m.authorUserId) === String(myUserId); // my account; blank matches nothing
// A thread message this run was NOT handed freezes its `since=` mark (`session-gate.js › enqueue`, W2).
const markGap = (s) => { if (s && s.catchUp) s.catchUp.gap = true; };

function feedLiveSession(entry, m, myUserId) {
  // ⚠ THE kind FILTER IS THE LAST WORD ON THIS MACHINE — a non-'message' post reaches no
  // session at all. Safe only because the server refuses thread_* kinds from an agent
  // (service-writes.assertLifecycleKindIsServerOwned), so prose can no longer ride in one. What
  // still arrives is a LIFECYCLE marker (a statement about a SESSION, not a person speaking) or
  // a `thread_progress` MILESTONE (feeding those spends one peer turn per milestone, on a stream
  // the product tells agents to post freely). Widening it also un-does the loop brake where a
  // loop is cheapest to start.
  if (!m) return false;
  const live = sessionEngine.liveOnThread({ channelId: entry.channel.id, threadId: targeting.firstClassThreadId(m) });
  // A thread row these returns never hand over gaps every live run but its author (W2; Samuel #4622: milestones too).
  const unhanded = () => { for (const s of live) if (!wroteIt(s, m) && !authoredBySession(s, m)) markGap(s); return false; };
  if (m.kind !== 'message') return unhanded();
  // ⚠ IDENTITY IS STILL REQUIRED AND STILL FAILS CLOSED. A machine that cannot say who it is has
  // no business deciding which of its agents a message is for — and since the narrowing it is
  // read for a second reason: a MEMBER recipient is routed by comparing against it.
  if (!myUserId) return unhanded();
  // ⚠ AN AUTHOR-LESS POST FAILS CLOSED. A row with no author is a system row, nobody spoke, and
  // `authorLabel` would credit the words to nothing.
  if (!m.authorUserId) return false;
  // 🔒 OFF-SCOPE ADDRESSEES (2026-10-29, Thread Mention Reach Fix): a `to=` agent working another
  // scope is fed too, under ITS OWN slot, framed "from <scope>, answer there". Context never widens.
  const scope = targeting.firstClassThreadId(m);
  const away = typeof dispatchScope !== 'undefined' && typeof sessionEngine.liveInChannel === 'function' // older slices inject neither
    ? dispatchScope.offScopeAddressees(m, live, sessionEngine.liveInChannel(entry.channel.id)) : [];
  if (!live.length && !away.length) return false;
  const liveIds = live.map((s) => String(s.agentId || ''));
  const plan = planFor(m, liveIds, myUserId);
  const named = plan.ids.concat(away.map((s) => String(s.agentId || '')).filter((id) => plan.ids.indexOf(id) === -1));
  const isAway = (s) => away.indexOf(s) !== -1;
  const gap = (s) => { if (!isAway(s)) markGap(s); }; // another scope's post is not a gap in this run's thread
  const authorName = authorLabel(m); // the AUTHOR, not just the account — see authorLabel
  const wakeAllowed = mayWake(m, myUserId);

  // ⚠ **THE RECEIPT IS FILED PER SESSION, WITH THAT SESSION'S OWN OUTCOME** (A9 + D3). It used
  // to be one aggregate over four counters plus an `earnedBy` table naming which session had
  // earned the winning word. `delivery-ack.js` holds ONE receipt per (operator, channel, seq)
  // and only ever STRENGTHENS it, so collapsing SEVERAL addressees onto one word is the buffer's
  // job rather than this loop's — which is what makes a multi-recipient send report compactly.
  // `myUserId` is the only identity that may claim a receipt (`session-state-push.js ›
  // trackOrigin`); the server SKIPS one whose key is not in this machine's own live set, which
  // is why the key is carried and never composed.
  const ack = (s, counts) => {
    const verdict = deliveryAck.verdictFor(counts);
    if (verdict) deliveryAck.note(entry.workspaceId, entry.channel.id, m.seq, verdict, myUserId, String(s.key || ''));
  };

  let fed = 0;
  let held = 0; // dormant agents this message named but could not wake
  let skipped = 0; // sessions this message was never for — the narrowing, counted
  for (const s of live.concat(away)) {
    // never feed a session its own post back — by the minted stamp OR the server's session key
    if (wroteIt(s, m) || authoredBySession(s, m)) continue;
    const forIt = isAway(s) || plan.ids.indexOf(String(s.agentId || '')) !== -1;
    // ⚠ NOT A REFUSAL AND NOT A HOLD. Nothing was aimed at this session, so nothing was
    // declined — filing a `refused` receipt here would report a decision the machine never made.
    if (!forIt && !plan.context) { skipped += 1; markGap(s); continue; }
    // ruling 5: parsed here, consumed by `session-seed.frameContinuation`. FRAMING ONLY — the
    // wake key is `wake` below.
    const addressing = addressingFor(s.agentId, named);
    const wake = forIt && wakeAllowed;
    if (!mayFeed(s, wake)) { held += 1; gap(s); ack(s, { held: 1 }); continue; }
    const wasDormant = dormant(s);
    const ok = sessionEngine.feedInbound({
      channelId: entry.channel.id,
      // ⚠ AN OFF-SCOPE SESSION IS FED UNDER ITS OWN SLOT; `fromScope` is where the post was.
      threadId: isAway(s) ? String(s.threadId || '') : scope,
      ...(isAway(s) ? { fromScope: { threadId: scope } } : {}),
      agentId: s.agentId,
      message: m.body,
      seq: m.seq, // the turn's seq — the windowless outbound bridge's thread join
      authorName: authorName, authorNote: agentAuthorNote(s, m, myUserId), replyTo: authorAddress(m, myUserId), // ⚠ the note: ONLY when THIS session's launch snapshot missed the author
      addressing: addressing, // ⚠ THE VERDICT, NOT THE INPUTS, below: `session-gate.js › feedInbound` is the entry point the
      // engine exports and is the BELT on this rule; handing it the answer is what stops it
      // becoming a second spelling of the wake rule.
      wake: wake === true, ...(m.authorKind !== 'agent' && m.metadata && m.metadata.source ? { source: m.metadata.source } : {}), // member's device (message-source.js)
      fromOperator: fromMe(m, myUserId), // the operator's account: their posts and their own agents' (ruling 2, 2026-09-25)
      // 🔴 WHO WROTE IT, for the inbound banner's weight (Samuel, 2026-10-12; `session-narration.js`'s
      // inbound arm + INVARIANTS §11): server-derived `author_kind`, only the two known spellings,
      // absent stays absent. It NARROWS ruling 2 for that face only; `fromOperator` rides beside it.
      ...(m.authorKind === 'agent' || m.authorKind === 'user' ? { authorKind: m.authorKind } : {}),
      // AND, FOR AN AGENT, its name and colour KEY (joined server-side; `agent-colors.ts` owns the palette).
      ...(m.authorKind === 'agent' && m.authorAgentName ? { authorAgentName: m.authorAgentName } : {}),
      ...(m.authorKind === 'agent' && m.authorAgentColor ? { authorAgentColor: m.authorAgentColor } : {}),
    });
    if (!ok) { gap(s); ack(s, { refused: 1 }); continue; }
    fed += 1;
    // ⚠ `wake` ALONE DOES NOT MEAN "STARTED": an ADDRESSED session already running carries
    // `wake: true` too (it is what `session-gate.js` stamps `lastWakeSeq` on). Different news,
    // different next action, so the receipt tells them apart — and `wasDormant` is read BEFORE
    // the feed, because feeding is what stops it being true.
    ack(s, { woke: wake && wasDormant ? 1 : 0, toAddressee: forIt ? 1 : 0, fed: 1 });
  }
  if (fed || held || skipped) {
    // ⚠ THE SKIPPED COUNT IS ON THE LINE ON PURPOSE, and it is the narrowing's only evidence. A
    // session a message was never for looks identical, from the outside, to one this machine
    // failed to route to — and the whole point of ruling B1 is that the drop is DELIBERATE.
    diag('fan-out', entry.channel.id.slice(0, 8), 'seq', m.seq,
      'fed', fed, 'of', live.length + away.length, away.length ? `off-scope:${away.length}` : '',
      held ? `held:${held} (no wake)` : '',
      skipped ? `skipped:${skipped} (not addressed)` : '',
      'verdict', storedVerdict(m) || 'unstored',
      named.length ? `to:${named.join(',')}` : plan.context ? 'thread' : 'nobody');
  }
  return fed > 0;
}

// ─── END SESSION-DISPATCH-PURE ─────────────────────────────────────────────────

module.exports = {
  feedLiveSession,
  mentionedAgentIds,
  serverAddressed,
  serverNamesMember,
  storedVerdict,
  planFor,
  addressingFor,
  mayFeed,
  mayWake,
  dormant,
};
