// Channels listener — passive thread-reply notification (Feature 4, requester side).
//
// When the REQUESTER receives an inbound reply that belongs to an INTERACTIVE
// thread they created, classify() (targeting.js) returns the 'thread-reply' verdict.
// Such a reply is not a new request: it needs NO consent row, NO watcher record,
// NO spawn. ⚠ AND SINCE 2026-10-09 IT RAISES NOTHING FOR BEING A REPLY (Samuel's spec): what
// still raises here is a reply that @-TAGS ME, routed as the `mention` it is — see
// `notifyThreadReply` below for why that path must exist at all. A click opens the channel via
// the SAME injected-handler seam trigger.sendFyi uses (targeting.openChannelForEntry,
// wired from index.js through targeting.setHandlers). No token use, no API write.
//
// It lives in its own tiny module because trigger.js (430/500) and
// session-spawner.js (443/500) sit at the eslint max-lines cap; the passive path
// must not grow either of them.
//
// EXTRACTION NOTE: `mentionNotice` is a pure, plain `function` declaration (like
// classify/metaStr) so test/thread-notify.test.mjs can slice + evaluate its body
// verbatim without loading Electron. Keep it free of braces inside its
// strings/comments/regex or the test's brace-balancing extractor breaks.

const io = require('./listener-io');
const targeting = require('./targeting');
const { metaStr, truncate } = targeting;
const { diag } = require('./diag');
// Which surface a passive notice takes, and the operator's switch for it. ⚠ `electron` and
// `notification-prefs` are NO LONGER required here: this module raises nothing itself and runs no
// gate of its own — `notificationRoute.raise` does both, so there is exactly one place that can.
const notificationRoute = require('./notification-route');

// The REPLY copy builder ("Reply in <thread>", "<Ada>: <summary>") is gone
// with the reply banner it wrote (Samuel's spec, 2026-10-09).
//
// What replaces it is `mentionNotice`, below, and the difference is the point: a tag inside my
// own thread is a MENTION, so it must read like one. It is the SAME builder `trigger.js › sendFyi`
// uses, so a tag looks identical whether it landed in a thread or in the room — one copy shape,
// one test, instead of two that drift.
//
// Pure: { title, body } from the message plus pre-resolved channel and author names. Prefers the
// server-stamped thread title for the headline (then the channel, then a name-free fallback) and
// the server-stamped summary for the body (then a truncated excerpt).
// ⚠ STAYS A PLAIN `function` DECLARATION WITH NO ELECTRON IN REACH: test/thread-notify.test.mjs
// reads this source and evaluates this builder alone, which is why the copy is testable at all.
function mentionNotice(m, channelName, authorName) {
  const where = metaStr(m, 'threadTitle') || channelName || 'a channel';
  const detail = metaStr(m, 'summary') || truncate(m && m.body, 120);
  return {
    title: where,
    body: authorName ? authorName + ' mentioned you: ' + detail : detail,
  };
}

/**
 * WHO THE MENTION BANNER CREDITS: the agent when an agent wrote it, the member when a person did.
 *
 * 🔒 **AN AGENT'S MENTION USED TO READ AS ITS OPERATOR'S** (Samuel, 2026-10-12: the banner said
 * *"Samuel Wang mentioned you"* for a post one of his OWN agents wrote). Both banner sites passed
 * `io.displayNameFor(m.authorUserId)` and nothing else, and **AN AGENT POSTS UNDER ITS OPERATOR'S
 * `author_user_id`** (server `service-writes.ts` — `author_user_id: ctx.userId` for every author
 * kind), so that name can only ever be the ACCOUNT's.
 *
 * ⚠ `authorKind` IS THE DISCRIMINATOR — the same one, for the same reason, as the silent
 * self-mention fixed at `targeting.js:162`: the author id cannot tell a person from their agent.
 * The agent's name rides the wire already (`dto.ts › mapMessageRow` joins `authorAgentName`
 * workspace-wide, so a PEER's agent resolves too) and `room-roster.js:161` already reads it.
 *
 * The four shapes, and why:
 *   mine, named      → `Cleanup Orchestrator`        — Samuel's spec: name the agent, plainly.
 *   mine, unnameable → `your agent`                  — NEVER my member name; that is the bug.
 *   peer, named      → `Dana's agent Prober`         — an agent name alone would not say whose.
 *   peer, unnameable → `Dana's agent`                — what `session-dispatch.js › authorLabel` says.
 * With neither half known it is `an agent`, and an unresolved operator id falls toward the PEER
 * phrasing, which is wrong-but-honest rather than wrong-and-silent.
 *
 * Pure, and a plain `function` declaration with no braces inside its strings/comments/regex, for
 * the same reason `mentionNotice` is one: test/thread-notify.test.mjs slices and evaluates it
 * verbatim, without Electron. The agent name is operator-set text landing in an OS notification
 * body, so it is stripped of line breaks and capped the way `room-roster.js › authorHandle` caps it.
 */
function mentionAuthorLabel(m, personName, myUserId) {
  const person = String(personName || '').trim();
  if (!m || m.authorKind !== 'agent') return person;
  const agent = String(m.authorAgentName || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 80);
  const mine = !!myUserId && String(m.authorUserId || '') === String(myUserId);
  if (mine) return agent || 'your agent';
  // The name cache missed this member. The agent's own name still beats 'an agent', and it is
  // the one case where a peer's agent reads like a bare name — honest, since whose is unknown.
  if (!person) return agent || 'an agent';
  return agent ? person + "'s agent " + agent : person + "'s agent";
}

/**
 * A REPLY IN MY THREAD. Samuel's spec (2026-10-09) turns this off: neither a human's nor an
 * agent's reply raises anything for being a reply.
 *
 * ⚠ BUT A MENTION STILL DOES, AND THAT IS WHY THIS FUNCTION STILL EXISTS. `classify` returns
 * 'thread-reply' for a post inside a thread I opened (`targeting.js:182`, `:190`) BEFORE it can
 * reach the mention arm (`:217`), so an @-mention made inside my own thread arrives HERE and not
 * at `sendFyi`. Deleting this path outright would have silenced a mention while the
 * Notifications tab still showed Mentions ON — silently unraisable, the twin of the silently
 * unmutable bug that opened this audit. `targeting.js:331` names the same overlap.
 *
 * So: tagged → raise it as the `mention` it is. Untagged → nothing at all, which is the ruling.
 * The thread still holds every reply either way, and the Tags inbox still holds the mention.
 */
function notifyThreadReply(entry, m, myUserId) {
  const cid = entry && entry.channel && entry.channel.id ? entry.channel.id.slice(0, 8) : '?';
  if (!targeting.mentionsMe(m, myUserId)) {
    diag('thread-reply', cid, 'seq', m && m.seq, '— no banner (spec 2026-10-09), thread holds it');
    return;
  }
  // ⚠ Routed as `mention`, the same event id and the same builder `sendFyi` uses, so a tag reads
  // identically whether it landed in a thread or in the room. `raise` runs the operator's switch,
  // so Mentions governs this too.
  // ⚠ THE LABEL IS BUILT FROM THE MESSAGE, not from the author id alone: an agent posts under its
  // operator's `author_user_id`, so `displayNameFor` is only the ACCOUNT half — see
  // `mentionAuthorLabel` for the rest. A tag in my own thread is the OWN-AGENT case by definition
  // on this path, so getting it wrong here is precisely what Samuel saw.
  const notice = mentionNotice(
    m,
    entry && entry.channel && entry.channel.name,
    mentionAuthorLabel(m, io.displayNameFor(m && m.authorUserId), myUserId)
  );
  const went = notificationRoute.raise('mention', {
    title: notice.title,
    body: notice.body,
    onClick: () => targeting.openChannelForEntry(entry, {
      threadId: metaStr(m, 'threadId') || null,
      seq: m && m.seq,
    }),
  });
  diag('thread-reply mention', cid, 'seq', m && m.seq, '→', went);
}

// TWO PASSIVE AGENT NOTICES lived here and are gone with named agents (channels rollback §1):
//
//   `notifyAgentEscalation` — classify's 'agent-escalation' verdict, a teammate's NAMED agent
//   addressing a PERSON. It named the handle, resolved by the CALLER off the authenticated
//   roster and passed in so this module's DEPENDENCY SET could not grow.
//
//   `notifyAgentDismissed` (FIX S2) — somebody addressed a DISMISSED agent of mine, which the
//   routing rule refused. It carried a per-(channel, agent) suppression window so a burst
//   aimed at one retired row was one notice.
//
// Neither verdict is reachable: nothing stamps `author_agent_id` or `to_agent_id` any more,
// and there are no rows to dismiss. What they were built to protect SURVIVES and is what this
// module still is — a passive lane that cannot reach anything which could spawn, gate or
// record a consent, pinned as its dependency set in test/wake-external-requester.test.mjs.

module.exports = {
  notifyThreadReply,
  mentionNotice,
  mentionAuthorLabel,
};
