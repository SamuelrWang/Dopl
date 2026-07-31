// Per-channel context a SESSION needs at launch: the identity of a channel this machine holds no
// local record of (resolve), and the permission posture a new session starts on (startingModes).
//
// WHY IT EXISTS: "Open session" on a thread card used to dead-end at "This thread has no session
// on this machine" whenever `session-store` had no durable record for (channel, thread) — which is
// every thread this Mac never worked, including the ones the operator most wants to READ. The
// always-open-window intent (v2.5 D3) needs three things a record would have carried, so we read
// them from the API the operator is already authenticated for:
//   workspaceId       — session-history's fetch and the MCP workspace pin both require it.
//   counterpartyId    — the FIX L1 binding. History lanes rows by it, and a shell with no bound
//                       counterparty paints the calm pointer instead of guessing (F4).
//   channelName       — the window header.
//
// COUNTERPARTY, NOT GUESSWORK: only a DIRECT (1:1) channel resolves one, from the server's own
// `directPeer` (the roster's other member). A group channel has no single counterparty, so this
// returns null for it — never an inferred peer. That much is unchanged and deliberate.
//
// WHAT THE NULL MEANS DOWNSTREAM CHANGED (FIX N1, 2026-07-31). It used to mean "the shell opens
// with no history at all": session-history bailed on a missing counterparty before it read
// anything, so "Open session" on a GROUP thread card opened an empty box. It now means "there is
// no side to call 'them'": the window paints the rows it can still attribute (the operator's own)
// and states both that it has no counterparty and how many other members' messages it is
// therefore not showing. Nothing here infers a peer to make that happen, and nothing here needs
// to know the difference between a group channel and a direct channel whose peer is unresolvable
// — the honest copy is the same for both, so this module stays a plain DTO reader.
//
// COST: one /api/workspaces + one /api/channels per workspace, on an operator CLICK only, cached
// for a minute. No writes (F-072), no realtime, no polling.

const listenerIo = require('./listener-io');
const { diag } = require('./diag');

const CACHE_TTL_MS = 60_000;
const cache = new Map(); // channelId -> { at, ctx }

// ─── BEGIN CHANNEL-CONTEXT-PURE (pure; unit-tested via source extraction) ────

// PURE: the context a Channel DTO yields, or null when the row cannot serve one. `isDirect` is
// the server's own 1:1 flag and `directPeer.userId` the other member — both server-resolved, so
// nothing here infers an identity. A channel the caller is not a member of yields null: they
// cannot read its messages, and an opened window would be an empty box.
function contextFromChannel(channel, workspaceId, workspaceSegment) {
  const c = channel || {};
  if (!c.id || !workspaceId) return null;
  if (c.isMember === false) return null;
  const peer = c.isDirect === true && c.directPeer && c.directPeer.userId ? c.directPeer : null;
  return {
    channelId: String(c.id),
    workspaceId: String(workspaceId),
    workspaceSegment: workspaceSegment || null,
    channelName: c.name == null ? null : String(c.name),
    counterpartyId: peer ? String(peer.userId) : null,
    counterpartyName: peer && peer.displayName != null ? String(peer.displayName) : null,
    // H2 (2026-07-31): the server's OWN 1:1 flag, carried separately from the peer it
    // resolves. A session needs it to say what an unaddressed post will DO — in a direct
    // channel the server addresses it (`resolveDirectPeer` stamps `to_user_id`), so the
    // outbound approval card must name the recipient; anywhere else it must not.
    // `=== true` only: an absent flag reads as NOT direct, which understates rather than
    // invents an addressee.
    direct: c.isDirect === true,
  };
}

// ─── END CHANNEL-CONTEXT-PURE ────────────────────────────────────────────────

function cached(channelId) {
  const hit = cache.get(channelId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.ctx;
  return undefined;
}

// Find the channel across every workspace the operator belongs to. Returns the context, or null
// when the channel is not visible to them at all (not a member, archived away, gone, or signed
// out) — the caller turns that into the ONE verdict that still shows the web card's note.
async function resolve(channelId) {
  const id = String(channelId || '');
  if (!id) return null;
  const hit = cached(id);
  if (hit !== undefined) return hit;
  let ctx = null;
  try {
    const workspaces = await listenerIo.listWorkspaces();
    for (const ws of workspaces || []) {
      if (!ws || !ws.id) continue;
      const channels = await listenerIo.listChannels(ws.id);
      const found = (channels || []).find((c) => c && c.id === id);
      if (!found) continue;
      const segment = ws.slug && ws.publicId ? `${ws.slug}-${ws.publicId}` : null;
      ctx = contextFromChannel(found, ws.id, segment);
      break;
    }
  } catch (err) {
    diag('channel-context: resolve failed', err && err.message);
    return null; // transient: do NOT cache a failure as "unknown channel"
  }
  cache.set(id, { at: Date.now(), ctx });
  return ctx;
}

function forget() {
  cache.clear();
}

// H2 (2026-07-31) — `startingModes` USED TO LIVE HERE, and it is deliberately gone.
//
// It read the per-channel permission preset and handed it to initialSessionState, and
// session-engine.startSession called it unconditionally. startSession is the single
// construction site for EVERY spawn shape, so that one line applied a stored posture to
// recreated parked shells, crash resumes, wakes and operator "Open session" clicks — none
// of which involve a human approving anything in that moment. A posture picked once on one
// consent card silently re-armed the channel forever after.
//
// The posture now travels ONLY as an explicit `spec.startModes` on the launch that a human
// is approving right now, consumed (and destroyed) at that seam by trigger.js. There is no
// ambient read for a spawn path to inherit by accident, which is the point: the absence of
// this function IS the fix. See main/channel-prefs.js for the arm/consume contract.

module.exports = { resolve, contextFromChannel, forget };
