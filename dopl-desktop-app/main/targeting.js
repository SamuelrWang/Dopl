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
// D2 adds two multiplayer rules, both in the "notify, never spawn" direction:
//   5. addressed to me as a HUMAN (to_user_id me, NO to_agent_id) by an AGENT author
//      (metadata.author_agent_id) → 'agent-escalation'. A notification, never a spawn.
//      NOT in a DIRECT channel, where the server addresses every post for you (FIX S1).
//   6. the implicit rule 2 is DISABLED while `entry.teamAgents` is non-zero — while this
//      operator has agents in the room, an unaddressed message triggers nobody. The count is
//      a TRI-STATE (FIX B1): seeded from the last known roster, confirmed by a read.
//   7. a post declaring `metadata.intent === 'chat'` triggers NOBODY, at any member count and
//      for any author kind. See the branch, which states why it sits where it does.
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
  // D2 ESCALATION — AN AGENT ADDRESSING ME AS A HUMAN NOTIFIES, IT NEVER SPAWNS.
  // Multiplayer gives agents a way to reach people: address the person. The server stamps
  // metadata.author_agent_id from a validated authorAgentId, so this is one of my teammates'
  // named agents asking a human for something, and the human it is asking is me. It must be
  // NEWS, not a request: spawning here would answer a question meant for a person with
  // another machine's agent, which is the loop this whole feature is built to avoid.
  // The `to_agent_id` conjunct is what keeps it honest. The OWNER BRIDGE stamps
  // to_user_id = the addressed agent's owner, so a message FOR my agent also names ME as
  // the user; only a message with NO agent addressee is actually addressed to me the person.
  // A message addressed to my AGENT is claimed earlier, by the routing route in
  // channel-agents.js, and never reaches this line.
  // FAILS toward today's behavior: no author_agent_id, or a to_agent_id present, and the
  // addressed rule below returns 'trigger' exactly as before.
  //
  // FIX S1 — NOT IN A DIRECT CHANNEL, WHERE ADDRESSING IS NOT A CHOICE. In a DM the server
  // auto-addresses every post to the peer (service-writes-metadata resolvePostMetadata:
  // toUserId falls back to the resolved direct peer whenever the caller named nobody), and a
  // team session always posts as_agent. So all four conjuncts below are satisfied by an
  // ORDINARY reply from the peer's agent, and the escalation notification fired per message,
  // NOT silent, saying somebody needs you when nobody said anything of the kind.
  // The wire cannot tell the two apart: the server stamps the SAME `to_user_id` for an
  // explicit `to` and for the DM fallback, and drops the caller's own copy first, so there is
  // nothing on the message to distinguish deliberate addressing from the auto-address.
  // A REAL agent-to-human escalation inside a DM therefore needs a server-side marker of its
  // own (a reserved `to_user_notify` key is already sketched in docs/MULTIPLAYER-PLAN.md);
  // that is a SERVER-lane follow-up, not something this file can invent. Until it exists a
  // direct channel keeps today's peer-agent handling — the branches above claim a thread
  // reply, and the addressed rule below returns 'trigger', which is consent-gated.
  // Group channels are unaffected: there `to_user_id` is stamped only from an explicit
  // address, so it IS the evidence this rule needs.
  if (
    m.authorKind === 'agent' &&
    toUserId === myId &&
    !isDirect &&
    metaStr(m, 'author_agent_id') &&
    !metaStr(m, 'to_agent_id')
  ) return 'agent-escalation';
  // CHAT — A POST THAT DECLARED IT ADDRESSES NOBODY TRIGGERS NOBODY.
  // The marker is restated from src/features/channels/schema.ts MessageIntentSchema and is
  // reserved + server-stamped, so it is a fact about the post rather than a claim in it (the
  // desktop's other reader is channel-engagement.isChat, which keeps the same const).
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
  // readers of one marker disagreed about the same post. The server validates the enum, so
  // neither spelling occurs in practice; the point is that both readers answer identically.
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
  // The responder posts its reply UNADDRESSED (author_kind=agent, no to_user_id
  // via postResult), so it lands here as FYI and cannot re-trigger the asker.
  // Loop-safe because every trigger is still consent-gated (a human clicks Allow
  // per hop) AND replies are unaddressed; only a deliberately-addressed follow-up
  // re-triggers, which is itself a consented turn. So a two-agent exchange can
  // never self-sustain without a human in the loop.
  if (m.authorKind === 'agent') return isMember ? 'fyi' : 'ignore';
  // Implicit 1:1 trigger (USER authors only) — but an explicit per-channel mute
  // ('none') wins over an IMPLICIT target: the sender never addressed us, and
  // the user asked for silence. Explicitly addressed requests above are never
  // suppressed.
  const scope = (entry.channel && entry.channel.myNotifyScope) || 'all';
  // D2 — ADDRESSING IS REQUIRED WHILE MY TEAM AGENTS ARE IN THE ROOM.
  // The implicit 2-member trigger is the pre-multiplayer convenience: in a DM, anything a
  // person says is for me, so no address is needed. That stops being true the moment this
  // operator has summoned agents into the channel — the room now holds several workers, and
  // an unaddressed message that spawns a session is precisely the "everyone answers at once"
  // failure the law exists to prevent. So while I have team agents here, an UNADDRESSED
  // human message triggers nobody. Explicit addressing is unaffected and still triggers
  // above, which is the point: address to act.
  // `entry.teamAgents` is a COUNT maintained by channel-agents.js off the channel's agent
  // roster (my own rows, summoned or active). It rides on the loop ENTRY rather than on the
  // channel DTO because reconcile replaces `entry.channel` wholesale each pass. Absent or
  // unparseable reads as 0, so every path that never sets it — and every existing test
  // harness — keeps today's behavior byte for byte.
  // FIX B1 — IT IS A TRI-STATE NOW, and this line is why. A loop starts LIVE before the
  // first reconcile pass reads any roster, and a roster read fails on a blip, a 5xx or a
  // pre-deploy 404 — so an unarmed count read as ZERO here and an unaddressed DM message
  // classified 'trigger', silently applying the pre-multiplayer rule. channel-listener now
  // SEEDS the entry from the durable last-known count and channel-agents sets
  // `entry.rosterKnown` only after a successful read, so "unknown" holds the last known
  // value (fail CLOSED toward the law) instead of collapsing to zero. Nothing changes for a
  // channel never known to hold agents: its seed is 0, exactly as before.
  const teamAgents = Number(entry && entry.teamAgents) || 0;
  if (knownTwo && isMember && teamAgents === 0) return scope === 'none' ? 'ignore' : 'trigger';
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


// ── Requester auto-open detector (v1.9, Q4) ──────────────────────────────────
// TRUE iff this message is MY OWN first-class create_task addressed to a peer, so
// the desktop opens a REQUESTER session window that drives the task. Checked by the
// listener SEPARATELY from classify() — it never touches classify's body, so the
// 1536-case truth table stays intact and a self-message still classifies 'ignore'
// for trigger/fyi. The task* keys are stamped SERVER-SIDE (metaStr reads them off
// metadata), so they cannot be spoofed by the caller.
//
//   - firstClassTaskId(m) present   → a real first-class (UUID) task, not legacy.
//   - m.authorUserId === myId       → MY message (my agent posted the create_task).
//   - taskCreatedBy === myId        → I created the task (the requester, not a peer).
//   - runtime === 'desktop-session' → a session THIS APP spawned opened the thread
//                                     (WAKE-V1; see below).
//   - taskTarget present && !== me  → it is addressed to a PEER (a self-targeted
//                                     task has no counterparty to drive against).
// De-dupe (one window per taskId) + backlog suppression + the settled-set are the
// listener's job; this helper is a pure predicate only.
//
// WAKE-V1 RUNTIME GATE. My own agent can open a thread from EITHER runtime: a window
// this app spawned (sdk-loader sends `X-Dopl-Runtime: desktop-session`, and the server
// stamps metadata.runtime off that header alone — `runtime` is RESERVED, so a value in
// the caller's message body is stripped) or the operator's own EXTERNAL Claude Code
// session, which sends no such header and therefore carries no runtime key at all. An
// external session now WAITS on the reply itself (it arms a long-held MCP await that
// wakes it when the peer answers), so auto-opening a desktop requester window for that
// thread put two agents on one thread and let the window consume the reply the waiting
// session was armed for. Unstamped (= external, or any non-desktop writer) therefore
// never auto-opens; the reply reaches the external agent through its await, and this
// machine's existing passive path (classify 'task-reply' → task-notify's silent banner)
// is the fallback when nothing is listening.
//
// THE STAMP IS A ROUTING HINT, NOT AN AUTHORIZATION SIGNAL (src/shared/auth/
// runtime-header.ts §"Header-only, deliberately"). Any holder of a device token can set
// that header, so `runtime` cannot attest WHO called — it only labels the expected
// origin. This gate is safe for two other reasons: it fails CLOSED (absence, a
// near-miss, or a non-string → no window, never a window), and it is one conjunct of an
// AND whose identity checks are the real bound — the message must be authored by ME and
// belong to a thread I created. Read alone, the stamp decides nothing.
function requesterTaskOpen(m, myId) {
  if (!m || m.kind !== 'message' || !myId) return false;
  if (!firstClassTaskId(m)) return false;
  if (m.authorUserId !== myId) return false;
  if (metaStr(m, 'taskCreatedBy') !== myId) return false;
  if (metaStr(m, 'runtime') !== 'desktop-session') return false;
  const target = metaStr(m, 'taskTarget');
  return !!target && target !== myId;
}

// ── Requester SHELL detector (2026-08-02) ────────────────────────────────────
// TRUE iff this message is MY OWN, HUMAN-TYPED, first-class thread opener addressed to a
// peer — the request the operator types in the app's own web view. The desktop opens a
// PINNED SHELL for it: a window plus the thread's transcript, with the agent NOT started.
//
// WHY IT IS A SECOND PREDICATE AND NOT A LOOSENED requesterTaskOpen. That helper answers a
// different question ("should a requester SESSION be launched and driven"), and its WAKE-V1
// runtime conjunct is load bearing: a thread my EXTERNAL Claude Code session opened must
// open nothing here, because that session awaits the reply itself and a window would steal
// it. The app's web view posts from the BROWSER context — cookies, no X-Dopl-Runtime header
// — so the server stamps no `runtime` key and the operator's own typed request was refused
// by exactly the conjunct written for external agents. Both are unstamped; the only thing on
// the wire that separates them is the AUTHOR KIND, and only a shell — which starts nothing,
// consumes nothing and can be evicted — is safe to open on that evidence.
//
//   - firstClassTaskId(m) present   → a real first-class (UUID) thread, not legacy.
//   - m.authorUserId === myId       → MY message.
//   - taskCreatedBy === myId        → I opened the thread (server-stamped, §Q4).
//   - taskTarget present && !== me  → addressed to a PEER.
//   - authorKind === 'user'         → a PERSON typed it. An 'agent' author is an agent
//                                     session's create and still opens NOTHING.
//   - no author_agent_id            → not an as_agent-attributed post. The server stamps that
//                                     key only from a validated authorAgentId, so an
//                                     operator's cookie session posting on an agent's behalf
//                                     is an agent's create no matter what kind it declares.
//   - runtime !== 'desktop-session' → a thread a DESKTOP-spawned session opened belongs to
//                                     requesterTaskOpen, which launches a full requester
//                                     session; this must never open a second window over it.
//
// THE AUTHOR KIND IS CALLER-ASSERTED, AND THAT IS ACCEPTABLE HERE. `authorKind` is an
// optional field on the post; the server derives it from the credential only when the caller
// omits it. So it is a ROUTING HINT, not an attestation — the same class of signal `runtime`
// is. It is safe to read because of what it decides: whether the OPERATOR'S OWN post opens a
// dormant window on the OPERATOR'S OWN machine. This is UX routing, NOT a security gate. The
// gate is the identity pair (authored by me AND created by me), which no peer can forge, and
// the worst a mis-declared kind can buy is a window the operator did not want — it starts no
// agent, grants no tool, posts nothing and reaches no peer.
function requesterShellOpen(m, myId) {
  if (!m || m.kind !== 'message' || !myId) return false;
  if (!firstClassTaskId(m)) return false;
  if (m.authorUserId !== myId) return false;
  if (m.authorKind !== 'user') return false;
  if (metaStr(m, 'author_agent_id')) return false;
  if (metaStr(m, 'taskCreatedBy') !== myId) return false;
  if (metaStr(m, 'runtime') === 'desktop-session') return false;
  const target = metaStr(m, 'taskTarget');
  return !!target && target !== myId;
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
  requesterTaskOpen,
  requesterShellOpen, // 2026-08-02: the operator's OWN typed request opens a pinned shell
  openChannelForEntry: win.openChannelForEntry,
  resolveToolProfile: win.resolveToolProfile,
};
