// channel-engagement.js — WHO A MESSAGE IS FOR when nobody said a name.
//
// THE MODEL, in one paragraph. A team agent of mine is IDLE or ENGAGED. Idle is the law this
// tree already shipped: "address to act" — the agent sees the whole room and acts on nothing
// it was not named in (targeting.classify disables the implicit 2-member trigger while I have
// agents here). ENGAGED is the widening: for a window after a human addressed it, that agent
// ALSO acts on UNTAGGED, NON-CHAT messages from the human who engaged it (and from its own
// owner), so a working exchange does not need an @ on every line. Nothing else changes: the
// implicit trigger stays off, a channel with no engaged agent behaves exactly as it did this
// morning, and an AGENT-authored message neither engages anybody nor triggers anybody, ever.
//
// THREE BOUNDS ON THE WIDENING, and each one is a predicate below rather than a comment:
//   AUTHORSHIP  human only (`humanAuthored` — the loop brake).
//   INTENT      not a declared `chat` post (`isChat` — human talk reaches nobody's agent).
//   RELATIONSHIP the human who engaged it, or the agent's own owner (`engagedTargets`).
//
// WHERE THE FACTS COME FROM. `channel_agents` gains `engaged_at` / `engaged_by` and the
// roster DTO this machine already reads (channel-agents.fetchRoster -> GET
// /api/channels/<id>/agents) carries them as `engagedAt` / `engagedBy`. The server stamps
// `engaged_at` when a human addresses the agent and does NOT sweep it: expiry is POLICY and
// the policy runs here (src/features/channels/constants.ts says exactly this). So this module
// is the whole of the desktop's engagement opinion.
//
// THE TWO CLOCKS, AND WHY THERE ARE TWO.
//   THE SERVER'S `engagedAt` IS THE FLOOR. It is the only thing that can START an engagement
//     — no local observation may invent one. That keeps the desktop from acting on a
//     widening the server, the web UI and the peer's machine know nothing about, and it
//     survives a restart, a reinstall, or an engagement begun while this app was closed.
//   A LOCAL SLIDING WINDOW EXTENDS IT. Engagement is refreshed BY ACTING, and the obvious
//     implementation — PATCH `engaged_at` every time an agent of mine takes a message — is
//     the F-072 anti-pattern verbatim: a WRITE on the read path, once per inbound message,
//     from every machine in the channel. So the refresh is LOCAL. `noteAgentActed` records
//     the moment in memory and `engagedAtFor` answers max(server floor, local act), which is
//     the same sliding window a PATCH would have produced for the ONE consumer that reads it
//     (this machine), at zero writes. What is given up is that a peer's machine cannot see
//     my agent's refreshed window — and nothing on a peer's machine consults it: an agent
//     runs only on its owner's Mac, so the owner's memory is the authoritative place for
//     "has it been busy lately". The floor still covers the cold-start case the local map
//     cannot.
//
// BOUNDED (F-072: nothing here grows without limit). One entry per (channel, agent) this
// operator has actually run, capped, and pruned oldest-first on write; an entry is dead
// weight the moment it ages past the TTL, so the same pass drops those too.

// ─── BEGIN CHANNEL-ENGAGEMENT-PURE (no requires at all; sliced whole by the truth tables) ──
// This block carries module state (the local act map), so it is sliced BETWEEN ITS SENTINELS
// rather than function by function — the LEGACY-THREADS idiom in targeting.js.

// THE WINDOW. Restated from the server's own constant — `ENGAGEMENT_TTL_MS` in
// src/features/channels/constants.ts (60 * 60_000) — which is the source of truth and the
// place to change it. It is restated rather than imported for the reason every server value
// in this tree is restated (the desktop is a separate package that ships on its own cadence
// and cannot import from the Next app); the comment is the link, and a drift shows up as
// this machine acting on an untagged message a minute after the web UI stopped calling the
// agent engaged, which is a cosmetic disagreement rather than a correctness one.
const ENGAGEMENT_TTL_MS = 60 * 60 * 1000;

// The local act map, and its bound. 200 (channel, agent) pairs is far past any real operator
// — an agent that is not this operator's own never gets an entry — and an entry older than
// the TTL can never change an answer again, so eviction loses nothing.
const ENGAGEMENT_ACT_CAP = 200;
const acted = new Map(); // `${channelId}:${agentId}` -> ms this agent last took a message

function actKey(channelId, agentId) {
  return String(channelId || '') + ':' + String(agentId || '');
}

// PURE: an ISO timestamp (or a number) as ms, or 0 for anything unusable. The DTO field is
// whatever the server serialized; a null, a blank, or a malformed date all mean "not engaged"
// rather than "engaged at the epoch", which is why this fails to 0 instead of NaN.
function stampMs(value) {
  if (value == null || value === '') return 0;
  const n = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ONE agent of mine acted on ONE message. Called from the route, on a confirmed feed and
// nowhere else — an attempt that was refused started no work, so it is not activity.
// NOT a write to the server (see the header): this is the sliding half of the window.
function noteAgentActed(channelId, agentId, nowMs) {
  const key = actKey(channelId, agentId);
  if (key === ':') return;
  const at = Number(nowMs) || Date.now();
  acted.delete(key); // re-insert so insertion order stays age order
  acted.set(key, at);
  for (const [oldest, when] of acted) {
    if (acted.size <= ENGAGEMENT_ACT_CAP && at - when <= ENGAGEMENT_TTL_MS) break;
    acted.delete(oldest);
  }
}

// PURE-ish: the effective engagement instant for one roster row — the LATER of the server's
// floor and this machine's last act. 0 when the server never engaged it, whatever the local
// map says: a local act may EXTEND an engagement and may never CREATE one.
function engagedAtFor(channelId, row) {
  const floor = stampMs(row && row.engagedAt);
  if (!floor) return 0;
  const local = acted.get(actKey(channelId, row && row.id)) || 0;
  return local > floor ? local : floor;
}

// PURE: is this row engaged RIGHT NOW?
//
// The boundary is EXCLUSIVE — an agent engaged exactly ENGAGEMENT_TTL_MS ago is idle. It used
// to be inclusive here and exclusive on the web (src/features/channels/lib/agent-engagement.ts
// deriveAgentEngagement: `age < ENGAGEMENT_TTL_MS`), a one-millisecond disagreement about
// whether a chip that reads "Idle" will still take an untagged message. The web is the copy an
// operator can see, so it wins.
//
// A STAMP FROM THE FUTURE IS CLOCK SKEW, NOT A LONGER ENGAGEMENT. Unclamped, a stamp an hour
// ahead bought the agent skew PLUS a full TTL of engaged time, and the TTL is the only bound
// the operator's own inactivity controls. Skew inside one TTL reads engaged (the web's
// reading: a future stamp is not a stale one), and anything further ahead is a clock this
// machine cannot reason about, so it reads IDLE rather than buying unbounded engagement.
function isEngaged(channelId, row, nowMs) {
  const at = engagedAtFor(channelId, row);
  if (!at) return false;
  const now = Number(nowMs) || Date.now();
  const age = now - at;
  if (age < 0) return -age <= ENGAGEMENT_TTL_MS;
  return age < ENGAGEMENT_TTL_MS;
}

// PURE: the agent ids ONE message addresses, newest contract first.
//
// `metadata.to_agent_ids` is the real list (a jsonb array, so it arrives as an Array — or as
// a JSON STRING if some writer stringified it, which is cheap to accept and expensive to be
// wrong about). `metadata.to_agent_id` is the COMPAT MIRROR the server keeps stamping: the
// first element of that list. So the array wins when it is there and the scalar is the whole
// answer when it is not, and an old server, an old desktop and a new one all agree on a
// single-address message.
//
// Order is preserved and duplicates are dropped, because the caller delivers to each id in
// turn and a repeated id would feed one agent twice.
function addressedAgentIds(m) {
  const meta = (m && m.metadata) || {};
  const out = [];
  const seen = new Set();
  const push = (v) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  let list = meta.to_agent_ids;
  if (typeof list === 'string' && list.trim().startsWith('[')) {
    try { list = JSON.parse(list); } catch (_) { list = null; }
  }
  if (Array.isArray(list)) for (const v of list) push(v);
  if (out.length) return out;
  push(meta.to_agent_id);
  return out;
}

// THE CHAT MARKER. Restated from src/features/channels/schema.ts (MessageIntentSchema), which
// is the source of truth and the place to change it — the same discipline the `desktop-session`
// runtime stamp is restated under, and for the same reason (the desktop is a separate package
// that cannot import from the Next app).
//
// `intent: 'chat'` means HUMAN TALK: the server skips the DM auto-address entirely, manufactures
// no `to_user_id` from the peer, and the post is declared as reaching NOBODY'S agent. It is the
// composer's DEFAULT, so it is the shape of most of what a person types.
const CHAT_INTENT = 'chat';

// PURE: was this post declared as addressing nobody?
//
// `metadata.intent` is RESERVED and server-stamped (service-writes-metadata deletes any
// caller copy and re-stamps only the validated top-level field), so this is a fact about the
// post, not a claim in it. FAILS TOWARD TODAY'S BEHAVIOUR on every miss: an ABSENT intent —
// every message an older server, an older desktop, or the MCP surface produces — reads as a
// REQUEST, and only the exact string suppresses. A malformed value is not chat.
function isChat(m) {
  const v = m && m.metadata ? m.metadata.intent : undefined;
  return v === CHAT_INTENT;
}

// PURE: was this message written by a PERSON?
//
// THE LOOP BRAKE, AND IT IS ABSOLUTE. An agent-authored message is refused here no matter how
// engaged anything is, no matter how many members the channel has, no matter who owns the
// agent that wrote it, and no matter what the message says — which is the ONE property that
// keeps two engaged agents from talking to each other forever, since every reply either
// machine posts is agent-authored by construction. `authorKind` is the server's own column
// (not caller-settable metadata), so this is not a heuristic.
//
// The CONJUNCTION mirrors the server's own `recordAgentEngagement`
// (src/features/channels/server/service-writes-agents.ts), which refuses to engage anything
// for `authorKind === 'agent'` OR a stamped `author_agent_id`. Two answers to "did a human
// write this" is one answer too many, so this is the same pair, inverted.
function humanAuthored(m) {
  if (!m || m.kind !== 'message' || m.authorKind !== 'user' || !m.authorUserId) return false;
  const meta = m.metadata || {};
  return !meta.author_agent_id;
}

// PURE: MAY an untagged message engage anybody at all?
//
// TWO REFUSALS, both of which are about what the message IS rather than who it is from:
//   NOT A HUMAN  the loop brake above.
//   CHAT         a post that declared it addresses nobody. Without this, one engagement made
//                every later line of a human conversation an inbound turn for the next 60
//                minutes — the exact thing chat mode exists to prevent, and a cost leak.
//                It holds for ANY author, MY OWN INCLUDED: chat means chat, and an operator
//                talking in the room is not addressing their own agent either. Naming the
//                agent (`to_agent_ids`) is how you address it, and that lane is claimed
//                before this one is ever consulted (channel-agents.routeAddressedAgent).
//
// MY OWN MESSAGES ARE NOT REFUSED ANY MORE. Excluding them was a fossil of the two-party
// ASSIST model, where the only trigger was a peer asking for something and "a message I wrote
// is not a request to me" was therefore true. A TEAM agent is summoned BY its operator and the
// person it is most listening for is that operator, so an untagged non-chat line of mine
// reaches my own engaged agent exactly as a peer's would.
function mayEngage(m, myUserId) {
  if (!humanAuthored(m)) return false;
  if (isChat(m)) return false;
  return !!myUserId;
}

// PURE: the rows of a channel's roster that MY engaged agents occupy, in roster order.
// Ownership is the authenticated roster's answer, never the message's — a peer cannot make
// this machine run anything by claiming anything.
//
// SCOPED TO `engagedBy`, because that is what the column means. The server stamps
// `engaged_at` / `engaged_by` together (repository-agents.markAgentsEngaged) and treats the
// pair as a RELATIONSHIP — "who this agent is listening for" — down to letting that person
// disengage it (service-agents.js: the owner OR `engaged_by` may). Ignoring it meant that in
// a six-person channel, one human engaging my agent handed everybody else's untagged asides
// to it as well. Now A engaging my agent widens the agent to A's lines and nobody else's.
//
// THE OWNER IS ALWAYS IN SCOPE. It is my agent, running on my machine, in a room I am in;
// the operator never needs to have "engaged" their own agent to talk to it. Fails closed on
// a missing `engagedBy` (an older server, a hand-built row): a non-owner author is refused.
function engagedTargets(channelId, rows, myUserId, authorUserId, nowMs) {
  const out = [];
  if (!myUserId || !authorUserId) return out;
  for (const row of rows || []) {
    if (!row || row.ownerUserId !== myUserId) continue;
    if (!isEngaged(channelId, row, nowMs)) continue;
    if (authorUserId !== myUserId && row.engagedBy !== authorUserId) continue;
    out.push(row);
  }
  return out;
}

// ─── END CHANNEL-ENGAGEMENT-PURE ───────────────────────────────────────────────────────────

module.exports = {
  ENGAGEMENT_TTL_MS,
  ENGAGEMENT_ACT_CAP,
  CHAT_INTENT,
  addressedAgentIds,
  engagedAtFor,
  isChat,
  humanAuthored,
  isEngaged,
  mayEngage,
  engagedTargets,
  noteAgentActed,
};
