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
//   (1) feedLiveSession — every message in a thread reaches EVERY live agent session this
//       machine is running on that thread. ⚠ DELIBERATELY UNGATED, and it always was: it
//       claims nothing into existence, and a live session's own existence is the gate.
//
// ── THE FAN-OUT (2026-08-21, Samuel's ruling 4) ───────────────────────────────────────────
//
// ⚠ THIS ROUTE USED TO FEED EXACTLY ONE SESSION EXACTLY ONE AUTHOR'S WORDS. It resolved THE
// session for (channelId, firstClassTaskId) and fed it only when `author === counterpartyFor(...)`,
// with the operator's own posts dropped outright (`m.authorUserId === myUserId` returned false).
// Both fences were correct for a world with ONE agent per thread and no way to talk to it in
// the channel. Multiplayer deletes the premise:
//
//   • N of MY agents may be live on one thread, so "the session" does not exist. Every one of
//     them is fed, EXCEPT the one that wrote the message.
//   • MY OWN posts are the operator steering their agents in the open, which is the product.
//     They are fed.
//   • A SIBLING AGENT'S posts are how two of my agents coordinate ("I'll take this one"). They
//     are fed to the siblings and never back to the author.
//
// ⚠ WHAT REPLACES THE COUNTERPARTY FENCE IS THE THREAD, AND THAT IS A REAL WIDENING, STATED
// PLAINLY. A third member of the channel posting INTO THIS THREAD now reaches my live agents as
// a turn, where before only the task's other party could. The thread is the scope Samuel ruled
// on ("every message in a thread feeds every live agent on it"), and the fences that survive
// are the ones that matter: nothing here MINTS a session, the body is still fenced as DATA
// (`session-seed.frameContinuation`), and the ADDRESSING LAW that decides whether a message may
// START an agent is untouched — `targeting.classify` is not consulted here and is not changed.
//
// ── THE SPAWN-IDLE WAKE RULE (2026-08-22, Samuel's ruling) ────────────────────────────────
//
// ⚠ ONE CLASS OF SESSION IS EXEMPT FROM THE FAN-OUT, AND IT IS EXEMPT UNTIL SOMEBODY DIRECTS IT.
// A SPAWN-IDLE agent (`sessions:launch` with `idle: true` — the New Agent button) is REGISTERED
// and has started no `claude` child at all: it holds a slot, a pill and an @-mention address, and
// `wakeEffects` starts its query on the first fed turn. Under the plain fan-out that first turn
// was whatever happened to be said next in the thread — so an agent an operator parked "ready"
// woke up on a passing remark between two other people, spent its launch on it, and answered
// something nobody asked it.
//
// SO AN UNWOKEN SPAWN-IDLE SESSION IS FED NOTHING. It wakes on exactly two things:
//   (a) A 1:1 MESSAGE from its own operator — `sessions:message` → `session-reopen.messageByTask`
//       → the reducer's `steer`, which is already a wake trigger and does not come through this
//       file at all.
//   (b) A THREAD OR MAIN-ROOM MESSAGE THAT @-MENTIONS ITS AGENT ID, from ANY author. ⚠ ANY: the
//       operator, a peer, or a PEER'S AGENT. That is Samuel's ruling verbatim ("user tells peer:
//       I'm going to wake another agent, you direct it"), and it is safe for the same reason the
//       parse itself is: an agent id is minted on this machine and known to no server, so a peer
//       can only name one they were told, and the parse is intersected with the ids actually live
//       on this thread.
//
// ⚠ EVERYTHING ELSE IS DROPPED, NOT QUEUED. There is no backlog to replay: the agent reads the
// thread ON DEMAND once directed, and that read costs no permission (`session-profiles.js ›
// isOwnChannelRead` scopes by channel only, and the windowless message floor auto-allows it), so
// nothing is lost by not pushing it. Queueing would only defer the same problem — a woken agent
// would open with a pile of context nobody addressed to it.
//
// ⚠ THE FLAG IS ITS OWN (`s.awaitingDirective`), NOT AN OVERLOAD OF `freshFraming`. That marker
// answers "does this turn carry the full framing", is consumed by `session-seed.takeFraming`, and
// is one-shot; this answers "may anything reach this agent yet", is read on every message, and is
// cleared by the WAKE rather than by the framing. Two questions, two fields — and the session
// engine clears this one at its single dispatch funnel so BOTH wake lanes clear it identically.
//
// ⚠ AND IT IS BELT-AND-BRACES. `session-gate.js › feedInbound` refuses the same message again,
// because this file is not the only thing that could ever call it.
//
// ⚠ SELF-FILTERING IS BY client_msg_id, NOT BY AUTHOR. Every agent on this machine posts under
// the OPERATOR'S OWN account with `authorKind: 'agent'`, so authorship cannot tell three of my
// agents apart, nor tell any of them from me. `session-outbound-tag.js` stamps each post with
// `agent-<agentId>-<n>` and the session records it (`session-engine.js › ownPostIds`), so a
// session recognises its own words coming back off the wire and nothing else does. A post that
// carries no id (an older build, a hand-made MCP call) is fed to everyone — including,
// harmlessly, its author, which is a duplicated turn rather than a lost one.
//
// ── TIERED WAKE (2026-08-28, Samuel's ruling) — AMENDS THE SPAWN-IDLE RULE ABOVE ───────────────
//
// ⚠ THE 2026-08-22 RULE ("only an @-mention or a 1:1 message wakes a dormant agent") IS AMENDED,
// NOT EXTENDED, and the amendment cuts both ways. `session-wake-tiers.js` carries the full
// argument and the loop fence; what belongs HERE is the routing, and three things about it:
//
//   1. THE TIER GATE GOVERNS **DORMANT** SESSIONS ONLY, AND THAT IS THE SCOPE DECISION OF THIS
//      BUILD. `dormant(s)` is "no `claude` query is running for this agent right now" — a
//      spawn-idle shell that never started one (`awaitingDirective`) or a session whose query was
//      torn down by an idle park (`state.parked`). A session that IS running keeps the plain
//      fan-out of ruling 4 (2026-08-21), untouched: every message in a thread reaches every live
//      agent on it, and a running agent needs no permission to hear the room it is already in.
//      ⚠ SO TIER 3 DOES NOT SILENCE A RUNNING AGENT, and a multi-agent room where two agents are
//      mid-conversation still feeds both. That is ruling 4 surviving, stated rather than
//      discovered; the residual is filed as REFACTOR-FINDINGS F-344.
//   2. "AGENTS ASSOCIATED WITH THE CHANNEL" IS `sessionEngine.agentIdsInChannel(channelId)` —
//      every UNSETTLED session this machine holds for that channel, thread-scoped and
//      channel-level alike, live and parked and spawn-idle alike. It is the registry, which is
//      the only honest source: `channel_agents` is a WRITE-DEAD legacy table
//      (`supabase/migrations/20260807000000_drop_unbound_tables_from_realtime.sql`), and agent
//      TEMPLATES are identities rather than channel bindings. ⚠ IT IS COUNTED CHANNEL-WIDE while
//      the FEED stays THREAD-scoped — the same asymmetry, for the same reason, that
//      `session-registry.js › agentIdsInChannel` already serves the framing's sibling list: two
//      of my agents in one channel can duplicate each other's work even when one is in a thread
//      and the other is watching the main room.
//   3. THE WAKE VERDICT TRAVELS AS ONE BOOLEAN (`wake`) TO `session-gate.js › feedInbound`, and
//      the belt now reads THAT rather than re-deriving the addressing rule. Two spellings of one
//      rule is how two readers come to disagree about one message — the gate's own header says so
//      about `addressing`, and this is the same argument applied to the tier that replaced it.

const targeting = require('./targeting');
const io = require('./listener-io');
const sessionEngine = require('./session-engine');
const wakeTiers = require('./session-wake-tiers');
const sessionTriage = require('./session-triage');
const agentHandles = require('./agent-handles');
const { diag } = require('./diag');

// ─── BEGIN SESSION-DISPATCH-PURE (routing; unit-tested via source extraction) ──

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

// THE @AGENT-ID PARSER, AND WHY IT LIVES ON THIS MACHINE (2026-08-21, ruling 5).
//
// ⚠ IT MUST NEVER BECOME A SERVER READ. `metadata.mentionedUserIds` is the server's stamped,
// unspoofable mention set, resolved against the channel ROSTER — and an agent id is not a
// member, so that resolver correctly answers "nobody". That fail-closed behaviour is right and
// stays: a caller-settable mention set is a notification-forgery primitive, and agent ids are
// minted per machine and known to no server. So the parse happens HERE, where the live agent
// ids are, and it decides nothing but FRAMING: an addressed message and an unaddressed one are
// both DELIVERED to every sibling (fan-out), and the difference is one sentence in the turn.
// Nothing about consent, triggering or tool grants reads this.
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
// ⚠ THE ORDER IS ID-FIRST AND IT IS NOT COSMETIC. `out` is the addressee list, and
// `session-wake-tiers.js › firstClaim` is not the only thing downstream that reads a list's
// ORDER — the framing prints it. An id is the address a peer was handed; a slug is one this
// machine resolved locally, so the exact address sorts ahead of the friendly one.
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

// The ADDRESSING verdict for one reader, handed to the framing.
//   null                       nobody was addressed — an ordinary thread message
//   { me: true,  ids: [...] }  this agent is one of the addressees
//   { me: false, ids: [...] }  somebody else's agent was addressed; read it as context only
function addressingFor(myAgentId, addressed) {
  if (!addressed || !addressed.length) return null;
  return { me: addressed.indexOf(String(myAgentId || '')) !== -1, ids: addressed };
}

// TRUE iff this session is the one that WROTE this message — the only exclusion in the fan-out.
function wroteIt(s, m) {
  const id = m && m.clientMsgId;
  if (!id || !s || !s.ownPostIds) return false;
  return s.ownPostIds.has(String(id));
}

// TRUE iff this session is a SPAWN-IDLE agent nobody has directed yet. ⚠ `=== true` ONLY, so a
// session object that predates the flag — or any shape that simply does not carry it — keeps the
// plain fan-out behaviour. A wake rule that fails toward "feed it" is the safe direction here:
// the failure it guards is a wasted launch, not a leak.
function unwoken(s) {
  return !!(s && s.awaitingDirective === true);
}

// TRUE iff NO `claude` query is running for this agent right now — the class the tier gate
// governs (see TIERED WAKE in the header). Two shapes, and they are genuinely different states
// that answer this one question the same way:
//   • a SPAWN-IDLE shell that never started a query (`awaitingDirective`)
//   • a session an idle park tore the query down for (`state.parked`), which a fed turn RESUMES
//     (`session-reducer.js › wakeEffects` -> `resumeQuery` -> `session-park.js › resumeParked`)
// ⚠ AN AUTH-HELD SESSION IS DORMANT AND CANNOT BE WOKEN AT ALL — `wakeEffects` refuses to resume
// while `authHeld`, so it is excluded from candidacy upstream rather than being triaged into a
// wake that would not happen. See `wakeCandidates`.
// ⚠ `=== true` ON BOTH, same reason as `unwoken`: an unfamiliar session shape keeps the fan-out.
function dormant(s) {
  if (unwoken(s)) return true;
  return !!(s && s.state && s.state.parked === true);
}

// May this message reach this session at all? The fan-out's ONE hold-back.
//
// ⚠ IT TAKES THE WAKE VERDICT, IT DOES NOT DERIVE ONE. `wake` is the tier decision already made
// for THIS message and THIS agent by `feedLiveSession` below — @-mention, solo room, or a triage
// claim — and it is the ONLY door for a dormant session. `addressing` no longer opens one: it was
// the whole rule until 2026-08-28 and is now framing alone, which is what it always was for every
// other session class.
// ⚠ FAIL TOWARD FEEDING FOR AN UNKNOWN SHAPE, unchanged: a session object that carries neither
// flag is not dormant and is fed everything. The failure this guards is a wasted launch, and the
// LOOP FENCE — the failure that has no bound — is upstream in `wakeTiers.wakeEligible`.
function mayFeed(s, wake) {
  if (!dormant(s)) return true;
  return wake === true;
}

// The dormant sessions a tier-2/3 wake may choose between, in SPAWN ORDER (the registry Map's
// insertion order, which `session-registry.js › liveOnThread` preserves and the tie-break reads).
// ⚠ THREE EXCLUSIONS, AND EACH IS A DIFFERENT FENCE: a session that WROTE this message is never a
// candidate for waking on it (the loop fence, per-session half); a session that is not dormant
// needs no wake; and an AUTH-HELD session cannot be resumed at all, so triaging one would spend a
// model call to reach a `resumeQuery` the reducer refuses.
function wakeCandidates(live, m) {
  return (live || []).filter((s) => dormant(s) && !wroteIt(s, m) && !(s && s.state && s.state.authHeld === true));
}

async function feedLiveSession(entry, m, myUserId) {
  // ⚠ THE kind FILTER IS THE LAST WORD ON THIS MACHINE — a non-'message' post reaches no
  // session at all. Safe only because the server refuses task_* kinds from an agent
  // (service-writes.assertLifecycleKindIsServerOwned), so prose can no longer ride in one. What
  // still arrives is a LIFECYCLE marker (a statement about a SESSION, not a person speaking) or
  // a `task_progress` MILESTONE (feeding those spends one peer turn per milestone, on a stream
  // the product tells agents to post freely). Widening it also un-does the loop brake where a
  // loop is cheapest to start.
  if (!m || m.kind !== 'message') return false;
  // ⚠ IDENTITY IS STILL REQUIRED AND STILL FAILS CLOSED. It no longer EXCLUDES my own posts —
  // that is the fan-out ruling — but a machine that cannot say who it is has no business
  // deciding which of its agents a message is for.
  if (!myUserId) return false;
  // ⚠ AN AUTHOR-LESS POST FAILS CLOSED, and it survived the fan-out ruling unchanged. What the
  // ruling removed was the comparison `authorUserId === myUserId` (my own posts are fed now);
  // the EXISTENCE check is a different rule — a row with no author is a system row, nobody
  // spoke, and `authorLabel` would credit the words to nothing.
  if (!m.authorUserId) return false;
  const taskId = targeting.firstClassTaskId(m);
  const thread = { channelId: entry.channel.id, taskId: taskId };
  const live = sessionEngine.liveOnThread(thread);
  if (!live.length) return false;
  const liveIds = live.map((s) => String(s.agentId || ''));
  // ⚠ THE NAME DOOR IS OPENED HERE, ONCE PER MESSAGE, AND ONLY OVER THIS THREAD'S AGENTS.
  // `handleIndexFor` reads `agent-names.js` — this machine owns every rename, so it is the only
  // authority there could be — and swallows a store failure into FEWER resolvable handles rather
  // than into a broken route (`agent-handles.js` states both).
  const addressed = mentionedAgentIds(m.body, liveIds, agentHandles.handleIndexFor(liveIds));
  const authorName = authorLabel(m); // the AUTHOR, not just the account — see authorLabel

  // ── THE TIER DECISION, MADE ONCE PER MESSAGE ────────────────────────────────────────────────
  // ⚠ THE LOOP FENCE IS ASKED FIRST AND OF THE MESSAGE, so no branch below can route around it:
  // an agent-authored post, a lifecycle marker or an authorless row wakes NOTHING, whatever it
  // says and whoever it names. It is still FED to every running session — that is ruling 4.
  const eligible = wakeTiers.wakeEligible(m);
  const candidates = eligible ? wakeCandidates(live, m) : [];
  // Which dormant agent, if any, a tier-2/3 wake awarded this message to. '' = nobody.
  let claimed = '';
  let tier = wakeTiers.TIER_NONE;
  if (candidates.length && addressed.length === 0) {
    // ⚠ CHANNEL-WIDE, THREAD-SCOPED FEED — see (2) in the header. An empty roster (a registry
    // this machine cannot read) answers TIER_NONE inside `tierFor`, which wakes nobody.
    tier = wakeTiers.tierFor({
      eligible: true,
      addressedMe: false,
      addressedAny: false,
      channelAgents: sessionEngine.agentIdsInChannel(entry.channel.id).length,
    });
    if (tier === wakeTiers.TIER_SOLO) {
      // ⚠ THE SOLO ROOM'S WINNER IS THE OLDEST DORMANT CANDIDATE ON THIS THREAD, not "the one
      // agent" — the roster is CHANNEL-wide and the feed is THREAD-scoped, so a solo channel can
      // still present zero or (across a thread boundary) more than one candidate here. Spawn
      // order is the same tie-break tier 3 uses, so the two tiers cannot disagree about which
      // agent a room means.
      claimed = String(candidates[0].agentId || '');
    } else if (tier === wakeTiers.TIER_TRIAGE) {
      claimed = await sessionTriage.claim({
        candidates: candidates,
        channelId: entry.channel.id,
        message: m.body,
        authorName: authorName,
      });
    }
  }

  let fed = 0;
  let held = 0; // dormant agents this message did not wake — see TIERED WAKE above
  for (const s of live) {
    if (wroteIt(s, m)) continue; // never feed a session its own post back
    // ruling 5: parsed here, consumed by `session-seed.frameContinuation`. FRAMING ONLY since
    // 2026-08-28 — the wake key is `wake` below, which the tier decision owns.
    const addressing = addressingFor(s.agentId, addressed);
    // TIER 1 (@-mention) is per-reader and is answered here, because `addressing` is; tiers 2
    // and 3 were answered above. Both are gated on `eligible`, which is the loop fence.
    const wake = eligible && (
      (addressing && addressing.me === true) || (claimed !== '' && String(s.agentId || '') === claimed)
    );
    if (!mayFeed(s, wake)) { held += 1; continue; }
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
      // becoming a second spelling of the tier table.
      wake: wake === true,
    });
    if (ok) fed += 1;
  }
  // ⚠ THE RING IS FED AFTER THE DECISION, NEVER BEFORE IT. It is the "last few messages" a later
  // triage prompt reads, and a message that included ITSELF in its own context would be asking
  // the router to route a message it has already seen.
  // ⚠ AND IT ONLY RECORDS CHANNELS THIS MACHINE HAS AN AGENT IN, because every guard above
  // returns first. That is the right bound — a channel with no session never triages, so context
  // for it would be memory spent on a question nobody asks — but it means a room whose agents all
  // ENDED starts the next spawn's router with an empty history. The router falls back to the
  // message alone, which is the honest answer rather than a stale one.
  wakeTiers.noteMessage(entry.channel.id, authorName, m.body);
  if (fed || held) {
    // ⚠ THE HELD COUNT IS ON THE LINE ON PURPOSE. A dormant agent that never wakes looks
    // identical, from the outside, to one this machine failed to route to — and the whole point
    // of the rule is that the drop is DELIBERATE. Without this the only evidence of a working
    // hold-back is an absence.
    diag('fan-out', entry.channel.id.slice(0, 8), 'seq', m.seq,
      'fed', fed, 'of', live.length, held ? `held:${held} (no wake)` : '',
      addressed.length ? `addressed:${addressed.join(',')}` : 'unaddressed',
      'tier', tier, claimed ? `woke:${claimed}` : '');
  }
  return fed > 0;
}

// ─── END SESSION-DISPATCH-PURE ─────────────────────────────────────────────────

module.exports = { feedLiveSession, mentionedAgentIds, addressingFor, mayFeed, dormant, wakeCandidates };
