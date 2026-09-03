// Session dispatch — the listener's pre-classify routing.
//
// ⚠ ONE ROUTE SURVIVES (2026-08-20, F-228). This file held FIVE, and four of them opened on a
// master-switch read that Samuel's live-test ruling turned permanently false. They are deleted
// with the machinery they drove — and the switch itself is gone too, a wave later:
//
//   (2) maybeOpenRequesterSession   MY OWN thread opener minted a REQUESTER WINDOW on MY OWN
//                                   machine and launched my agent against my own message. This
//                                   is the self-trigger bug the retirement was ruled from.
//   (3) maybeSurfaceRequesterReply  a peer reply on a thread I requested, HELD at that window's
//                                   inbound gate. No window, no gate, no hold.
//   (4) noteRequestLifecycle        advanced the request STRIP in the window chrome.
//   (5) maybeReopenAddressedThread  a peer follow-up reopened the window that answered it,
//                                   via the shell-recreate lane.
//
// `diagRuntimeGateSkip`, `REQUEST_MILESTONES`, `exchangeTag` and `reopenableRecord` were
// helpers of those four alone and went with them.
//
//   (1) feedLiveSession — the delivery lane. It claims nothing into existence; a live session's
//       own existence is the gate.
//
// ── THE FAN-OUT IS NARROWED TO THE ADDRESSED RECIPIENT (2026-09-02, ruling B1) ─────────────
//
// ⚠ THIS REVERSES SAMUEL'S RULING 4 OF 2026-08-21 — *"every message in a thread feeds every
// live agent on it"* — AND THE REVERSAL IS THE WHOLE OF THIS ROUTE NOW. Ruling 4 was right for
// a machine that had no other answer: WHO a message was for was re-derived here, from the body,
// by every desktop in the field, so the only safe reading of an unaddressed post was "everybody
// on the thread". It cost a peer turn per agent per message and it made a room of agents answer
// each other.
//
// ⚠ **WHO A MESSAGE IS FOR IS NOW DECIDED ONCE, ON THE SERVER, AT WRITE TIME** — INVARIANTS §5,
// THE DELIVERY KEYSTONE. `src/features/channels/server/service-wake-verdict.ts` stores
// `wake_verdict` plus `recipient_user_ids` / `recipient_agent_ids` on the row, and this machine
// EXECUTES that answer rather than re-deriving one. The seven verdicts route as follows:
//
//   agent · responder     the named agent ids. They are FED and they are WOKEN.
//   member · thread_peer   a MEMBER. Their machine decides what runs — so if that member is
//     · reciprocal         this operator, their live sessions on the thread hear it as context
//                          and NONE of them is woken; if it is a peer, nothing here is fed.
//   thread                 no recipient, but a thread tag: the sessions already working that
//                          thread hear it and nobody is woken.
//   none                   nobody.
//
// ⚠ **THE THREE RESILIENCE ARMS ARE WHAT MAKE THE NARROWING SAFE** (RR1/RR2/RR3, INVARIANTS §5).
// Narrowing to the addressed recipient means a message that named nobody would reach nobody, and
// Samuel's ruling in the same breath is that a forgotten `@` must never stall a conversation. The
// repair is the SERVER's, resolved once at write time, so every desktop gets it at once and the
// weakest build in the field no longer sets the rule. Nothing on this machine repairs an address.
//
// ⚠ **AND THE FALLBACK IS THE WHOLE COMPATIBILITY STORY. IT HAS TWO CAUSES AND THEY ARE THE SAME
// FACT: THE SERVER DID NOT ANSWER.**
//   • NO `wakeVerdict` AT ALL — a build older than `20260912120000`, or a row written before it.
//     This machine parses the body itself and fans out exactly as it did on 2026-08-21. That is
//     ruling 4, kept intact for as long as a server can still speak the old shape.
//   • A verdict WITH `recipientAgentIds: null` — handles were named and the server could not
//     resolve them (a PEER's agent, whose id is minted on their machine and known to no server;
//     or a projection row not yet pushed). The body parse answers for the agent half ONLY; the
//     verdict still routes the member half. `[]` is an ANSWER — "this body names no agent" — and
//     is executed, never re-derived. Collapsing `null` and `[]` silences a live agent, which is
//     the one failure this whole seam exists to prevent.
//
// ── THE LOOP FENCE IS ONE PREDICATE NOW (2026-09-02) ───────────────────────────────────────
//
// ⚠ TWELVE RULES OVER "WHO WAKES", ACROSS `session-wake-tiers.js`, `session-triage.js` AND THIS
// FILE, BECOME FOUR BRAKES AND ONE OF THEM IS TWO LINES. The three that were always structural
// are unchanged:
//   • a non-`message` kind reaches no session at all (the `kind` filter below);
//   • an AUTHORLESS row reaches nothing — a system row, nobody spoke;
//   • a session is never fed its OWN post (`wroteIt`, by `client_msg_id` — every agent on this
//     machine posts under the operator's account, so authorship cannot tell three of mine apart).
// The fourth — the 2026-08-31 SAME-ACCOUNT CARVE — is `mayWake` below, and it is what is left of
// `wakeEligibility`'s three-string enum. It is REDUNDANT under a stored verdict, because the
// server resolves an agent recipient against the AUTHOR'S OWN sessions and can therefore never
// name a peer's agent; it is LOAD-BEARING under the body-parse fallback, where the door is open
// again. One predicate that is right in both places beats two spellings of one rule.
//
// ⚠ **THE LLM TRIAGE TIER IS DELETED** (ruling B6). Tier 2 (the solo room) and tier 3 (a
// claim/pass model call per dormant candidate) both answered "which of my agents did this
// unaddressed human message mean?" — a question RR3 now answers SERVER-SIDE for free, for every
// desktop at once, with no model call and no held cursor. Tier 1 (the @-mention) is not gone: it
// is the `agent` verdict, resolved through the same handle grammar the transcript tints with.
//
// ── THE SPAWN-IDLE WAKE RULE (2026-08-22, Samuel's ruling) ────────────────────────────────
//
// ⚠ ONE CLASS OF SESSION IS EXEMPT FROM DELIVERY, AND IT IS EXEMPT UNTIL SOMEBODY DIRECTS IT.
// A SPAWN-IDLE agent (`sessions:launch` with `idle: true` — the New Agent button) is REGISTERED
// and has started no `claude` child at all: it holds a slot, a pill and an @-mention address, and
// `wakeEffects` starts its query on the first fed turn. So an unwoken spawn-idle session is fed
// NOTHING unless this message WAKES it — an address, not an overhearing. Everything else is
// DROPPED, not queued: the agent reads the thread ON DEMAND once directed, and that read costs no
// permission (`session-profiles.js › isOwnChannelRead`), so nothing is lost by not pushing it.
//
// ⚠ THE FLAG IS ITS OWN (`s.awaitingDirective`), NOT AN OVERLOAD OF `freshFraming`. That marker
// answers "does this turn carry the full framing", is consumed by `session-seed.takeFraming`, and
// is one-shot; this answers "may anything reach this agent yet", is read on every message, and is
// cleared by the WAKE rather than by the framing. Two questions, two fields — and the session
// engine clears this one at its single dispatch funnel so BOTH wake lanes clear it identically.
//
// ⚠ AND IT IS BELT-AND-BRACES. `session-gate.js › feedInbound` refuses the same message again,
// because this file is not the only thing that could ever call it.

const targeting = require('./targeting');
const io = require('./listener-io');
const sessionEngine = require('./session-engine');
const agentHandles = require('./agent-handles');
// THE RECEIPT BUFFER (2026-09-02, A9). Above the sentinel like every other dep, so the
// extracted block reaches it as a free var and the truth tables can inject a fake.
const deliveryAck = require('./delivery-ack');
const { diag } = require('./diag');

// ─── BEGIN SESSION-DISPATCH-PURE (routing; unit-tested via source extraction) ──

// ⚠ THE SERVER'S OWN VOCABULARY, RESTATED — `src/features/channels/types-delivery.ts ›
// ChannelWakeVerdict`. A word this build does not know reads as NO ANSWER and takes the
// fallback, which is the same direction an absent column takes: a newer server may add a
// verdict, and an installed desktop must degrade to today's behaviour rather than to silence.
const VERDICTS = ['none', 'member', 'agent', 'thread', 'thread_peer', 'reciprocal', 'responder'];

// The verdicts whose recipient is a MEMBER rather than an agent — an explicit `to=` and the two
// resilience arms that REPAIR one (RR1, RR2). ⚠ They are three values and not a flag beside
// `member` because a transcript has to be able to tell an address the author WROTE from one the
// server repaired; the ROUTING is the same for all three, which is why they share a list here.
const MEMBER_VERDICTS = ['member', 'thread_peer', 'reciprocal'];

// WHO WROTE THIS MESSAGE, for the wrapper a session is fed it inside.
// ⚠ `io.displayNameFor` names the ACCOUNT a post came from, and a peer's AGENT posts from the
// peer's account — so "<name> replied in the channel…" credits a person for a machine's words.
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

// The agent ids the server resolved, intersected with the sessions live here.
//
// ⚠ **ABSENT IS NOT EMPTY.** An ARRAY — EMPTY INCLUDED — is the server's authoritative answer
// and the body parse is not run at all; `null` is "not resolved there" and falls through to the
// parse, which is today's behaviour exactly. `??` and never `||` at the call site.
// ⚠ **STILL INTERSECTED WITH `liveIds`**: the server resolves the author's own sessions
// CHANNEL-wide and this feed is THREAD-scoped — which is also what stops the server naming a
// session this machine does not have.
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
// web tree now WRITES and TINTS `@agent-<id>` (`src/features/channels/lib/agent-mentions.ts`),
// and the bare `@<id>` form is what every message written before that carries — so both resolve,
// and the prefix is optional in the pattern rather than a second regex. **A convention change
// that only moved the renderer would have rendered a blue token this parser ignored**, which is
// the tint-says-tagged / stamp-says-nobody defect F-266 already cost a wave to fix once.
//
// ⚠ THE NEGATIVE LOOKBEHIND IS WHAT KEEPS THE TWO FORMS FROM OVERLAPPING. Without it the bare-id
// alternative would ALSO match inside `@agent-k3v7d2mq` — `-` is a non-word character, so a plain
// boundary sees `k3v7d2mq` there — and a single mention would resolve twice. It is harmless today
// (`out` de-dupes) and would stop being the moment anything counted matches.
//
// ⚠ AND SLUGGED CUSTOM NAMES SINCE 2026-08-28 (Samuel's F-350 ruling: "the parser learns names").
// `@research-bot` reaches the agent its operator renamed "Research Bot", because the picker
// INSERTS that form (`lib/agent-mentions.ts › agentMentionHandle` prefers the slug over the id)
// and the transcript TINTS it — so a parser that read only the id forms was rendering a blue
// token it ignored for very nearly every named agent. The slug rule, the token strip and the
// ambiguity fence all live in `agent-handles.js`; what belongs HERE is that there are TWO DOORS
// and how they compose:
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

// ── THE DOOR THE SERVER DELIBERATELY DOES NOT RESOLVE: AN ESCALATION ANSWER ────────────────────
// A human pressing an option on an ESCALATION CARD posts an ordinary message carrying reserved
// `metadata.escalationAnswer` — and the agent that ASKED the question is the one that must be
// told (Samuel, 2026-08-31).
//
// ⚠ IT IS RESOLVED HERE BECAUSE IT CANNOT BE RESOLVED THERE. `escalationAnswer.agentId` names the
// agent that asked, which belongs to whoever posted the escalation — usually not the author — so
// `service-wake-verdict.ts` would have to answer `[]` for it, and `[]` is authoritative. The
// machine is the only place the thread's live ids are known, so the union happens here.
//
// ⚠ IT IS STRICTLY LESS FORGEABLE THAN THE BODY DOORS, which is the argument for it existing. An
// `@` reads the BODY, which any member can type; this key is stripped from caller input
// unconditionally and re-stamped server-side only after the caller is proved to be a member that
// escalation asked, with the agent id DERIVED from the escalation's own post stamp
// (`server/service-writes-metadata-escalation.ts`). A member cannot aim it.
//
// ⚠ WHY THE ANSWER DOES NOT SIMPLY WRITE `@agent-<id>` IN THE BODY: the raw agent id is never
// user-visible chrome (INVARIANTS §11), and a PEER's machine cannot know the asking agent's
// display name — so the body token is the only form available to them and it is the forbidden one.
// ⚠ INTERSECTED WITH `liveIds` LIKE EVERY OTHER DOOR. An answer naming an agent that is not on
// this thread contributes nothing rather than reaching for one.
function escalationAnswerAgentIds(m, liveIds) {
  if (!liveIds || !liveIds.length) return [];
  const meta = m && m.metadata;
  const answer = meta && typeof meta === 'object' ? meta.escalationAnswer : null;
  if (!answer || typeof answer !== 'object') return [];
  const id = typeof answer.agentId === 'string' ? answer.agentId : '';
  if (!id || liveIds.indexOf(id) === -1) return [];
  return [id];
}

/**
 * THE DELIVERY PLAN FOR ONE MESSAGE, ON THIS MACHINE.
 *
 *   ids      the agent sessions this message is FOR. Fed, and woken if dormant.
 *   context  feed every OTHER live session on the thread, waking none of them.
 *
 * ⚠ **`context` IS NOT A SECOND FAN-OUT.** It is true in exactly three situations, and each is
 * the server having said "this reaches the thread and wakes nobody": the `thread` verdict, a
 * MEMBER recipient who is this operator (their machine decides what runs; the agents already
 * working the thread hear it), and the OLD-SERVER fallback, which is ruling 4 preserved whole.
 * Everything else — a message for a peer, a message for nobody — feeds nothing at all.
 */
function planFor(m, liveIds, myUserId) {
  const verdict = storedVerdict(m);
  const ids =
    serverAddressed(m, liveIds) ??
    mentionedAgentIds(m.body, liveIds, agentHandles.handleIndexFor(liveIds));
  for (const id of escalationAnswerAgentIds(m, liveIds)) {
    if (ids.indexOf(id) === -1) ids.push(id);
  }
  if (!verdict) return { ids: ids, context: true }; // no answer stored: ruling 4, unchanged
  if (ids.length) return { ids: ids, context: false }; // narrowed to whoever was named
  const forMe = MEMBER_VERDICTS.indexOf(verdict) !== -1 && serverNamesMember(m, myUserId);
  return { ids: ids, context: verdict === 'thread' || forMe };
}

// The ADDRESSING verdict for one reader, handed to the framing.
//   null                       nobody was addressed — an ordinary thread message
//   { me: true,  ids: [...] }  this agent is one of the addressees
//   { me: false, ids: [...] }  somebody else's agent was addressed; read it as context only
// ⚠ THE THIRD SHAPE IS REACHABLE ONLY ON THE OLD-SERVER FALLBACK NOW. Under a stored verdict a
// session that was not named is not fed at all, so nobody pays for a line telling them to stand
// down — which is why `session-seed.js › addressingLines` no longer has an unaddressed branch.
function addressingFor(myAgentId, addressed) {
  if (!addressed || !addressed.length) return null;
  return { me: addressed.indexOf(String(myAgentId || '')) !== -1, ids: addressed };
}

// TRUE iff this session is the one that WROTE this message — the only exclusion in the feed.
function wroteIt(s, m) {
  const id = m && m.clientMsgId;
  if (!id || !s || !s.ownPostIds) return false;
  return s.ownPostIds.has(String(id));
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
 * signed-in operator**. A PEER's agent starts nothing here, which is the 2026-08-28 ruling
 * unchanged; the operator's own agents may @-wake each other, which is what makes `launch_agent`
 * over MCP a capability rather than an id nobody can spend.
 *
 * ⚠ **REDUNDANT UNDER A STORED VERDICT, LOAD-BEARING UNDER THE FALLBACK.** The server resolves
 * an agent recipient against the AUTHOR'S OWN sessions, so no stored verdict can name a peer's
 * agent; the body-parse fallback has no such structure and this is its fence. One predicate that
 * holds in both places, rather than a rule the server states and the machine re-states.
 * ⚠ FAILS CLOSED ON THE IDENTITY: a blank or unknown operator id can never equal a non-blank
 * author id, so the comparison needs no second branch.
 * ⚠ IT GATES THE **WAKE** AND NEVER THE FEED. An agent-authored message still reaches a session
 * that is already RUNNING — that is how two of my agents coordinate.
 */
function mayWake(m, myUserId) {
  if (!m || m.authorKind !== 'agent') return true;
  const me = String(myUserId || '');
  return !!me && String(m.authorUserId) === me;
}

function feedLiveSession(entry, m, myUserId) {
  // ⚠ THE kind FILTER IS THE LAST WORD ON THIS MACHINE — a non-'message' post reaches no
  // session at all. Safe only because the server refuses task_* kinds from an agent
  // (service-writes.assertLifecycleKindIsServerOwned), so prose can no longer ride in one. What
  // still arrives is a LIFECYCLE marker (a statement about a SESSION, not a person speaking) or
  // a `task_progress` MILESTONE (feeding those spends one peer turn per milestone, on a stream
  // the product tells agents to post freely). Widening it also un-does the loop brake where a
  // loop is cheapest to start.
  if (!m || m.kind !== 'message') return false;
  // ⚠ IDENTITY IS STILL REQUIRED AND STILL FAILS CLOSED. A machine that cannot say who it is has
  // no business deciding which of its agents a message is for — and since the narrowing it is
  // read for a second reason: a MEMBER recipient is routed by comparing against it.
  if (!myUserId) return false;
  // ⚠ AN AUTHOR-LESS POST FAILS CLOSED. A row with no author is a system row, nobody spoke, and
  // `authorLabel` would credit the words to nothing.
  if (!m.authorUserId) return false;
  const taskId = targeting.firstClassTaskId(m);
  const thread = { channelId: entry.channel.id, taskId: taskId };
  const live = sessionEngine.liveOnThread(thread);
  if (!live.length) return false;
  const liveIds = live.map((s) => String(s.agentId || ''));
  const plan = planFor(m, liveIds, myUserId);
  const authorName = authorLabel(m); // the AUTHOR, not just the account — see authorLabel
  const wakeAllowed = mayWake(m, myUserId);

  // ⚠ **THE RECEIPT IS FILED PER SESSION, WITH THAT SESSION'S OWN OUTCOME** (A9 + D3). It used to
  // be one aggregate over four counters plus an `earnedBy` table naming which session had earned
  // the winning word — bookkeeping that existed only because a message reached many sessions.
  // With one recipient there is nothing to aggregate, and `delivery-ack.js` already holds ONE
  // receipt per (operator, channel, seq) and only ever STRENGTHENS it, so the collapse is the
  // buffer's job rather than this loop's. `myUserId` is the only identity that may claim a
  // receipt (`session-state-push.js › trackOrigin`); the server SKIPS one whose session key is
  // not in this machine's own live set, which is why the key is carried and never composed.
  const ack = (s, counts) => {
    const verdict = deliveryAck.verdictFor(counts);
    if (verdict) {
      deliveryAck.note(entry.workspaceId, entry.channel.id, m.seq, verdict, myUserId,
        String(s.key || ''));
    }
  };

  let fed = 0;
  let held = 0; // dormant agents this message named but could not wake
  let skipped = 0; // sessions this message was never for — the narrowing, counted
  for (const s of live) {
    if (wroteIt(s, m)) continue; // never feed a session its own post back
    const named = plan.ids.indexOf(String(s.agentId || '')) !== -1;
    // ⚠ NOT A REFUSAL AND NOT A HOLD. Nothing was aimed at this session, so nothing was
    // declined — filing a `refused` receipt here would report a decision the machine never made.
    if (!named && !plan.context) { skipped += 1; continue; }
    // ruling 5: parsed here, consumed by `session-seed.frameContinuation`. FRAMING ONLY — the
    // wake key is `wake` below.
    const addressing = addressingFor(s.agentId, plan.ids);
    const wake = named && wakeAllowed;
    if (!mayFeed(s, wake)) { held += 1; ack(s, { held: 1 }); continue; }
    const wasDormant = dormant(s);
    const ok = sessionEngine.feedInbound({
      channelId: entry.channel.id,
      taskId: taskId,
      agentId: s.agentId,
      message: m.body,
      seq: m.seq, // the turn's seq — the windowless outbound bridge's thread join
      authorName: authorName,
      addressing: addressing,
      // ⚠ THE VERDICT, NOT THE INPUTS. `session-gate.js › feedInbound` is the entry point the
      // engine exports and is the BELT on this rule; handing it the answer is what stops it
      // becoming a second spelling of the wake rule.
      wake: wake === true,
    });
    if (!ok) { ack(s, { refused: 1 }); continue; }
    fed += 1;
    // ⚠ `wake` ALONE DOES NOT MEAN "STARTED": an ADDRESSED session already running carries
    // `wake: true` too (it is what `session-gate.js` stamps `lastWakeSeq` on). Different news,
    // different next action, so the receipt tells them apart — and `wasDormant` is read BEFORE
    // the feed, because feeding is what stops it being true.
    ack(s, { woke: wake && wasDormant ? 1 : 0, toAddressee: named ? 1 : 0, fed: 1 });
  }
  if (fed || held || skipped) {
    // ⚠ THE SKIPPED COUNT IS ON THE LINE ON PURPOSE, and it is the narrowing's only evidence. A
    // session a message was never for looks identical, from the outside, to one this machine
    // failed to route to — and the whole point of ruling B1 is that the drop is DELIBERATE.
    diag('fan-out', entry.channel.id.slice(0, 8), 'seq', m.seq,
      'fed', fed, 'of', live.length,
      held ? `held:${held} (no wake)` : '',
      skipped ? `skipped:${skipped} (not addressed)` : '',
      'verdict', storedVerdict(m) || 'unstored',
      plan.ids.length ? `to:${plan.ids.join(',')}` : plan.context ? 'thread' : 'nobody');
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
