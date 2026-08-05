// Channels listener — message targeting + window handoff.
//
// SPLIT NOTE (§2 refactor): extracted from channel-listener.js. Holds the
// targeting classifier (`classify`/`metaStr`), the tool-profile resolver, and the
// notification→window handoff (`openChannelForEntry` + the `handlers` it uses).
//
// CRITICAL: test/classify.test.mjs (plus main-audit-targeting / task-notify /
// wake-external-requester) reads THIS file and evaluates the `classify` and
// `metaStr` function bodies verbatim. Keep them as plain top-level `function`
// declarations with no braces inside their strings/comments/regex, or the test's
// brace-balancing extractor breaks. classify also calls into the LEGACY-THREADS
// block below, which those harnesses slice whole between its BEGIN/END sentinels
// (it carries module state, so it cannot be extracted function by function).

// §2 SPLIT (2026-07-31): the notification->window handoff (setHandlers /
// openChannelForEntry) and the tool-profile resolver moved to targeting-window.js when this
// file had to grow the CHAT suppression. Both are re-exported below, so no caller changed.
// They are required at module scope and NEVER referenced from classify, which is what keeps
// the brace-balancing extractors above workable.
const win = require('./targeting-window');

function truncate(s, n = 240) {
  const str = String(s == null ? '' : s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// A trimmed non-empty string from message metadata, else ''.
function metaStr(m, key) {
  const v = m && m.metadata ? m.metadata[key] : undefined;
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

// ── Targeting classification (Feature A) ─────────────────────────────────────
// Returns 'trigger' (prompt for consent + maybe spawn), 'fyi' (silent notify
// only), or 'ignore'. FAIL CLOSED: unknown identity or my own message → ignore.
//   1. metadata.to_user_id present → trigger only if it equals me; else FYI
//      (multi-member) / ignore. Applies to USER *and* AGENT authors — an agent
//      EXPLICITLY addressed to me is the core Channels use case (one user's
//      agent asks another user's agent) and MUST trigger.
//   2. absent + USER author + exactly 2 members → implicit target (trigger).
//   3. absent + AGENT author → FYI (member) / ignore — never an implicit
//      trigger. This is the LOOP BRAKE (see the classify body).
//   4. absent + 3+ members → FYI only (documentation / chat), never a trigger.
//   5. a post declaring `metadata.intent === 'chat'` triggers NOBODY, at any member count and
//      for any author kind. See the branch, which states why it sits where it does.
// D2 ADDED TWO MORE and both are gone with the named agents they described (channels
// rollback §1): an 'agent-escalation' verdict for a teammate's NAMED agent addressing me as
// a person, and the disabling of rule 2 while `entry.teamAgents` was non-zero ("address to
// act"). Nothing stamps `author_agent_id` or `to_agent_id` any more, and nothing summons.
// authorKind must be 'user' or 'agent'; anything else (e.g. 'system') → ignore.
// memberCount comes from the Channel DTO (refreshed on reconcile). The implicit
// 2-member trigger FAILS CLOSED: it fires only on a known-exact count of 2 and
// explicit channel membership — an absent/invalid count or unknown membership is
// treated as multi-member (FYI, no prompt). Rationale: a stale DTO must never
// mass-prompt a group channel (the exact bug addressing exists to prevent);
// addressed-to-me requests are unaffected and always trigger.
function classify(m, entry, myId) {
  // Guard / fail closed. Agent authors are NO LONGER rejected wholesale (that
  // dropped every ask-another-agent message before addressing was even checked);
  // authorKind must be 'user' or 'agent', so 'system' and friends still ignore.
  //
  // P0-4 DECISION (2026-08-04): the kind guard STAYS. It was only ever dangerous
  // because PROSE COULD RIDE IN A task_* KIND — an answer posted as task_finished
  // was dropped here and raised no consent, no notification, nothing. The server
  // refuses those three from an agent now, so what reaches this line is a runtime
  // LIFECYCLE marker or a MILESTONE, and neither is a request somebody has to
  // decide about: raising a consent card for "Started working on this request."
  // is the noise this guard exists to prevent. A milestone that IS meant for one
  // of my agents is claimed earlier, by channel-agents.routeAddressedAgent, and
  // never reaches classify at all.
  if (!m || m.kind !== 'message' || !m.authorUserId) return 'ignore';
  if (m.authorKind !== 'user' && m.authorKind !== 'agent') return 'ignore';
  if (!myId) return 'ignore';
  if (m.authorUserId === myId) {
    // Still 'ignore' for targeting. But my OWN addressed message is the only place
    // this machine ever learns which LEGACY threads it opened, so record it on the
    // way past (noteMyLegacyThread is a no-op for anything else). See the registry.
    noteMyLegacyThread(m, entry, myId);
    return 'ignore';
  }

  const rawCount = Number(entry.channel && entry.channel.memberCount);
  const knownTwo = Number.isFinite(rawCount) && rawCount === 2;
  // Only an explicit `isMember: false` blocks (public channel the operator can
  // see but is not in — never prompt/FYI for those); a missing field degrades
  // to member so a DTO field drift can't silently stop 1:1 answering.
  const isMember = !(entry.channel && entry.channel.isMember === false);
  // FIX S1: in a DIRECT channel the server addresses EVERY post automatically, so
  // `to_user_id` there is not evidence that anybody addressed anybody.
  const isDirect = !!(entry.channel && entry.channel.isDirect === true);

  const toUserId = metaStr(m, 'to_user_id');
  // TASK-REPLY (Feature 4, requester side): an inbound reply that belongs to an
  // INTERACTIVE task *I created* and is addressed back to me is passive news — a
  // reply landed — NOT a fresh request. It must not raise consent or spawn; the
  // dispatcher fires a silent notification instead. The task* keys are stamped
  // SERVER-SIDE (Q4), so they cannot be spoofed by the caller. taskCreatedBy ===
  // me separates the REQUESTER (this branch) from the RESPONDER (taskCreatedBy
  // !== me → falls through to today's 'trigger'); taskTarget === the author
  // binds the suppression to the RESPONDER specifically, so a THIRD member
  // posting into my task (author !== the task's target) still triggers instead
  // of being silently swallowed. This sits BEFORE the addressed rules so it wins
  // over the plain 'trigger'. Anything that is not interactive + mine +
  // addressed-to-me + authored-by-the-target (autonomous mode, an old message
  // with no taskMode, a non-message kind rejected by the guards above) falls
  // through UNCHANGED.
  //
  // AUDIT D1: the suppression is AGENT-ONLY. The predicate below is EXACTLY the shape of
  // a human responder @-tagging the requester back (the 1.7.9 peer-post path posts
  // authorKind 'user' with the same server-stamped task keys), and a passive notice has no
  // consent row, no gate and no Accept, so a person's addressed message could be swallowed
  // into a banner whenever the pre-classify routes missed it (no live session AND no
  // durable record or no window budget). A HUMAN addressing me always gates: a 'user'
  // author falls through to the addressed rule below and returns 'trigger'. Only the
  // AGENT reply this branch was designed for stays passive news.
  if (
    m.authorKind === 'agent' &&
    metaStr(m, 'taskId') &&
    metaStr(m, 'taskMode') === 'interactive' &&
    toUserId === myId &&
    metaStr(m, 'taskCreatedBy') === myId &&
    metaStr(m, 'taskTarget') === m.authorUserId
  ) return 'task-reply';
  // LEGACY TASK-REPLY (incident 2026-07-31). The branch above can only ever fire for a
  // FIRST-CLASS thread, because taskMode / taskCreatedBy / taskTarget are stamped ONLY
  // from a resolved channel_tasks row; a legacy 'task-<channel>-<seq>' id is not a UUID,
  // resolves to no row, and therefore carries NOTHING but the caller-set taskId itself
  // (src/features/channels/server/service-writes-metadata.ts resolvePostMetadata: the
  // four keys are deleted unconditionally and re-stamped only when `task` is non-null).
  // So a session answering a LEGACY request posts an addressed, agent-authored reply that
  // looks EXACTLY like a fresh request on the requester's machine, and the requester's
  // desktop opened consent + spawned a counter-session against its own reply.
  //
  // The missing bit is provenance, and it cannot come off the wire (a legacy id is
  // caller-settable, so any member could claim one). It comes from THIS MACHINE: the
  // registry below holds the legacy ids of threads *I* opened, computed from my own
  // outbound messages, which no peer can author. A reply tagged with one of those ids,
  // from the very member I addressed, back to me, is my own outstanding request being
  // answered. Same passive-notice outcome as the first-class branch, same AGENT-ONLY
  // rule (AUDIT D1: a human addressing me always gates).
  //
  // FAILS SAFE toward 'trigger', never toward silence: an unknown id, an id evicted by
  // the cap, a restart, or a first-watch backlog we never classified all leave the
  // message on today's addressed path, where the consent gate is the safety net.
  if (
    m.authorKind === 'agent' &&
    toUserId === myId &&
    knownLegacyReply(m, myId)
  ) return 'task-reply';
  // AN ESCALATION VERDICT SAT HERE. A teammate's NAMED agent addressing ME, the human
  // (`author_agent_id` present, no `to_agent_id`), had to be NEWS rather than a request:
  // spawning would answer a question meant for a person with another machine's agent. Both
  // keys are unstampable now (channels rollback §1) — no `as_agent`, no owner bridge — so the
  // branch could never fire again, and an agent-authored addressed message falls to the
  // addressed rule below exactly as it did before D2.
  //
  // CHAT — A POST THAT DECLARED IT ADDRESSES NOBODY TRIGGERS NOBODY.
  // The marker is restated from src/features/channels/schema.ts MessageIntentSchema and is
  // reserved + server-stamped, so it is a fact about the post rather than a claim in it (the
  // desktop's other reader was channel-engagement.isChat, which kept the same const; that
  // module is gone and this is now the marker's ONE reader on this machine).
  // WHY IT MATTERED: chat is the composer's DEFAULT, and under chat the server stamps no
  // to_user_id from the peer at all, so an ordinary "sounds good" in a DM fell straight past
  // the addressed rules into the implicit 2-member rule and spawned an ASSIST session anyway.
  // Two humans talking in a DM with no agents behaved exactly as before the feature shipped.
  // WHERE IT SITS AND WHY: AFTER the two task-reply branches and the escalation (all three are
  // passive notices that spawn nothing, so chat has nothing to suppress there) and BEFORE
  // every branch that can return trigger. Explicit AGENT addressing is unaffected and is not
  // even reached here: chat WITH to_agent_ids is the documented primary way an agent is given
  // work, and channel-agents.routeAddressedAgent claims those messages ahead of classify.
  // FAILS TOWARD TODAY'S BEHAVIOUR: only the exact string suppresses. An absent intent — every
  // message an older server, an older desktop or the MCP surface writes — is a request.
  // READ RAW, NOT THROUGH metaStr, and that is not an oversight. metaStr TRIMS, which is right
  // for an id and wrong for a reserved enum: it made ' chat' suppress here while
  // channel-engagement.isChat (a plain ===) called the same message a request, so the two
  // readers of one marker disagreed about the same post. That second reader is gone, and the
  // raw read stays — the server validates the enum, so no other spelling occurs, and a
  // trimming read here would be a rule this file states differently from the server.
  const CHAT_INTENT = 'chat';
  const intent = m.metadata ? m.metadata.intent : undefined;
  if (intent === CHAT_INTENT) return isMember ? 'fyi' : 'ignore';
  if (toUserId) {
    // Explicit address always prompts — for USER *and* AGENT authors. This is
    // the fix: an agent addressed to me triggers a consented answering turn.
    if (toUserId === myId) return 'trigger';
    if (toUserId === m.authorUserId) return 'ignore'; // self-addressed noise
    return isMember ? 'fyi' : 'ignore';
  }
  // LOOP BRAKE: an UNADDRESSED agent can never trigger — FYI (member) / ignore.
  //
  // P1-5 (2026-08-04) — THE SECOND CLAUSE OF THIS COMMENT WAS FALSE IN EVERY DM,
  // which is the only shape the DM product has. It said "the responder posts its
  // reply UNADDRESSED (author_kind=agent, no to_user_id via postResult), so it
  // lands here as FYI" — and `postResult` really does send no `to`. But in a
  // DIRECT channel the SERVER addresses it: `resolvePostMetadata` falls back to
  // `peerUserId` when nobody was named, so `to_user_id` IS stamped, the addressed
  // rule above claims the message, and this branch is never reached at all. A
  // courtesy no-op ("please resend") therefore arrived as a trigger, raised
  // consent, and could spawn a session under a synthetic `task-<channel>-<seq>`
  // id against a message that asked for nothing. Two agents can ping-pong that
  // way; only the consent gate stopped it, and standing trust removes the gate.
  //
  // WHAT ACTUALLY BRAKES A DM, therefore, is `intent:"chat"` — suppressed
  // unconditionally a few lines above, ahead of every branch that can return
  // 'trigger', and skipped by the auto-address server-side so there is nothing to
  // trigger on in the first place. `channel-post.postCourtesy` is what stamps it,
  // and the incidental posts are the ones that reach for it.
  //
  // THIS BRANCH still does its job everywhere the server addresses nothing for
  // you — a group channel, and a DM post that carried an explicit `intent` — and
  // the consent gate remains the belt in front of both.
  if (m.authorKind === 'agent') return isMember ? 'fyi' : 'ignore';
  // Implicit 1:1 trigger (USER authors only) — but an explicit per-channel mute
  // ('none') wins over an IMPLICIT target: the sender never addressed us, and
  // the user asked for silence. Explicitly addressed requests above are never
  // suppressed.
  const scope = (entry.channel && entry.channel.myNotifyScope) || 'all';
  // D2 GATED THIS ON `entry.teamAgents` — the implicit 2-member trigger was DISABLED while
  // this operator had summoned agents in the room, because the room then held several
  // workers and an unaddressed message that spawned a session was the "everyone answers at
  // once" failure the law existed to prevent. Address to act. Summoning is gone (channels
  // rollback §1), so a two-member channel holds one worker per side again and the implicit
  // trigger is the whole rule, as it was before D2. The tri-state that armed it (FIX B1: a
  // durable seed plus `entry.rosterKnown`) went with the roster read it hedged against.
  if (knownTwo && isMember) return scope === 'none' ? 'ignore' : 'trigger';
  return isMember ? 'fyi' : 'ignore';
}

// A first-class (UUID) task id off an inbound message, else '' — the desktop
// threads its reply + lifecycle under it so a responder's turn groups into the
// requester's task card. Legacy task-<uuid>-<seq> ids are NOT UUIDs -> '' here,
// so the deterministic legacy id path (taskIdFor's fallback) is unchanged.
// Mirrors the server's isUuid gate so only a real first-class task threads.
function firstClassTaskId(m) {
  const id = metaStr(m, 'taskId');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : '';
}

// ── Legacy thread registry (incident 2026-07-31) ─────────────────────────────
// §2 SPLIT (2026-07-31): the registry itself — what it is for, why a peer cannot forge one,
// its two bounds and its injected persistence — moved to legacy-threads.js when this file
// went past the 500-line cap. Destructured HERE, at module scope, so classify's body keeps
// calling `noteMyLegacyThread` / `knownLegacyReply` as free variables and the truth tables
// that slice that body verbatim did not have to change a line of it.
const {
  LEGACY_THREAD_CAP,
  LEGACY_THREAD_TTL_MS,
  LEGACY_THREAD_KEY,
  legacyThreadId,
  noteMyLegacyThread,
  knownLegacyReply,
  useLegacyThreadStore,
} = require('./legacy-threads');


// ── The two DESKTOP runtime stamps (src/shared/auth/runtime-header.ts) ───────
// `desktop-session` — a session THIS APP spawned (sdk-loader / mcp-config send the
//   header on the device token).
// `desktop-ui` — the operator typing in THIS APP'S OWN UI window. Its posts leave
//   main, not the renderer (main/ui-bridge.js builds every header; the preload exposes
//   no header surface), on the operator's own SESSION credential — and the server
//   refuses that value to any agent credential, so an external MCP caller cannot claim
//   it by sending the header.
// Both are values the SERVER writes into the reserved `metadata.runtime` key; a
// caller-supplied copy in the message body is always stripped.
const DESKTOP_RUNTIMES = ['desktop-session', 'desktop-ui'];

// TRUE iff this message carries one of the two stamps this app produces.
function desktopRuntime(m) {
  return DESKTOP_RUNTIMES.indexOf(metaStr(m, 'runtime')) !== -1;
}

// ── Spawn-with-handoff (rollback §3.5) ───────────────────────────────────────
// TRUE iff this message's create DECLARED a handoff — an EXTERNAL agent (the
// operator's own Claude Desktop / Claude Code over MCP) asking that the session
// driving this thread open on THIS machine rather than being kept by the
// external session that posted the create. `handoff` is a RESERVED metadata key:
// the server strips any caller copy and re-stamps it only from the validated
// create_thread field (src/features/channels/server/service-writes-metadata.ts),
// so it is a fact about the create, not a claim in it — read `=== true`, the
// strict boolean the server writes. Like the runtime stamp it is a ROUTING HINT
// and NOT an authorization: `requesterTaskOpen` still demands the identity pair
// (author === me AND task creator === me) around it, and those are what no peer
// can forge, so a handoff can never open a window on anybody else's machine.
function declaresHandoff(m) {
  return !!(m && m.metadata && m.metadata.handoff === true);
}

// ── Requester auto-open detector (v1.9, Q4; widened 2026-08-05) ──────────────
// TRUE iff this message is MY OWN first-class thread opener addressed to a peer, so
// the desktop opens a REQUESTER session window that drives the thread. Checked by the
// listener SEPARATELY from classify() — it never touches classify's body, so the
// 1536-case truth table stays intact and a self-message still classifies 'ignore'
// for trigger/fyi. The task* keys are stamped SERVER-SIDE (metaStr reads them off
// metadata), so they cannot be spoofed by the caller.
//
//   - firstClassTaskId(m) present   → a real first-class (UUID) task, not legacy.
//   - m.authorUserId === myId       → MY message (I, or my agent, opened the thread).
//   - taskCreatedBy === myId        → I created the task (the requester, not a peer).
//   - a DESKTOP runtime stamp       → this app posted it, from one of its two runtimes
//     OR a declared handoff           (WAKE-V1 + rollback §3.4); OR the create DECLARED a
//                                     handoff (rollback §3.5), the operator asking an
//                                     EXTERNAL session to hand the thread to a window here.
//   - taskTarget present && !== me  → it is addressed to a PEER (a self-targeted
//                                     task has no counterparty to drive against).
// De-dupe (one window per taskId) + backlog suppression + the settled-set are the
// listener's job; this helper is a pure predicate only.
//
// ONE INITIATING BEHAVIOUR, NOT THREE (2026-08-05, docs/CHANNELS-ROLLBACK-PLAN.md §3.4).
// This used to demand `desktop-session` exactly, which split the operator's own requests
// into two outcomes for a reason that no longer exists. The app's own UI posted from a
// BROWSER context — cookies, no header — so the server stamped nothing, the operator's
// typed request looked exactly like an external agent's create, and the desktop opened a
// dormant SHELL on the only evidence left (a caller-asserted `authorKind`). The app owns
// that renderer now and stamps its own posts `desktop-ui`, so the evidence is server-side
// and the shell has no remaining justification: a user who deliberately flipped the
// composer to *request* has given clear intent, and BOTH desktop runtimes start the agent.
// The predicate was NOT loosened to get there — it still demands a server-written stamp;
// there is simply a second one now.
//
// WAKE-V1 RUNTIME GATE, and the ONE thing that now lets an unstamped create through it.
// The operator's own EXTERNAL Claude Code session sends no runtime header and carries no
// runtime key. By DEFAULT that session WAITS on the reply itself (it arms a long-held MCP
// await), so auto-opening a desktop requester window for its thread would put two agents on
// one thread and let the window consume the reply the session was armed for — so an
// unstamped create with NO handoff still opens NOTHING, and the reply reaches the external
// agent through its await (with this machine's passive 'task-reply' banner as the fallback).
//
// SPAWN-WITH-HANDOFF (rollback §3.5) is the operator explicitly asking for exactly that
// transfer. When the create DECLARED handoff (`declaresHandoff`, a server-stamped reserved
// flag), the external session is saying "I do NOT keep this — open the driving session on my
// machine." So a declared handoff clears the stamp conjunct in the external session's place,
// and the window opening here is correct because it is what was asked for. The stamp is NOT
// loosened for anything else: an unstamped, un-declared create is still inert. And handoff
// is only ever HONORED alongside the identity pair below — it substitutes for the runtime
// stamp, never for "this is MY OWN thread", so it cannot open a window on a peer's machine.
//
// THE STAMP IS A ROUTING HINT, NOT AN AUTHORIZATION SIGNAL (src/shared/auth/
// runtime-header.ts §"Header-only, deliberately"). A device-token holder can set the
// header, so `runtime` cannot attest WHO called — it only labels the expected origin, and
// the server's own credential bound on `desktop-ui` narrows the population that may claim
// it rather than proving anything about one caller. This gate is safe for two other
// reasons: it fails CLOSED (absence, a near-miss, or a non-string → no window, never a
// window), and it is one conjunct of an AND whose identity checks are the real bound — the
// message must be authored by ME and belong to a thread I created. Read alone, the stamp
// decides nothing.
function requesterTaskOpen(m, myId) {
  if (!m || m.kind !== 'message' || !myId) return false;
  if (!firstClassTaskId(m)) return false;
  if (m.authorUserId !== myId) return false;
  if (metaStr(m, 'taskCreatedBy') !== myId) return false;
  // The stamp conjunct, OR a declared handoff in its place (rollback §3.5): a
  // desktop-posted create opens the window as before, and an EXTERNAL create
  // that DECLARED handoff opens it too — that is the operator asking for the
  // transfer. Nothing else (an unstamped, un-declared create) opens anything.
  if (!desktopRuntime(m) && !declaresHandoff(m)) return false;
  const target = metaStr(m, 'taskTarget');
  return !!target && target !== myId;
}

// TRUE iff this message is the OPERATOR'S OWN typing in the app's UI, rather than one of
// their spawned sessions. The listener uses it for one display-only decision — arming the
// request lifecycle strip, which says what happened to the request the operator sent
// (Sent / Accepted / Declined / Replied). A session-posted create needs no such line: the
// session that posted it is already narrating in its own window. Read ONLY alongside
// requesterTaskOpen, never as a gate of its own.
function requesterTypedByOperator(m) {
  return metaStr(m, 'runtime') === 'desktop-ui';
}

module.exports = {
  setHandlers: win.setHandlers,
  truncate,
  metaStr,
  classify,
  firstClassTaskId,
  LEGACY_THREAD_CAP,
  LEGACY_THREAD_TTL_MS, // S5: the registry's two bounds, asserted by the truth tables
  LEGACY_THREAD_KEY,
  legacyThreadId,
  noteMyLegacyThread,
  knownLegacyReply,
  useLegacyThreadStore, // Q11: index.js injects electron-store at boot
  DESKTOP_RUNTIMES, // the two stamps this app produces (asserted by the truth tables)
  declaresHandoff, // rollback §3.5: the reserved handoff flag an external create may set
  requesterTaskOpen,
  requesterTypedByOperator, // 2026-08-05: which of the two, for the lifecycle strip only
  openChannelForEntry: win.openChannelForEntry,
  resolveToolProfile: win.resolveToolProfile,
};
