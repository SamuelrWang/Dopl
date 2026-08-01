// realtime-agents.js — the `channel_agents` ROSTER DOORBELL, on its own realtime channel.
//
// SPLIT NOTE (§2, 2026-07-31): this came out of realtime.js when the UPDATE binding pushed
// that file past the 500-line cap. The seam was already argued in the prose below and merely
// not honoured in the file layout — this subscription is deliberately OUTSIDE the breaker,
// outside the health calculation and outside the wake coalescer, so it shares nothing with
// the message transport but the client object it is handed.
//
// `channel_agents` is in the publication (migration 20260731120000) and its RLS SELECT
// mirrors channel_messages, so this is the same authenticated subscriber pattern with no
// new credential and no server change. It obeys realtime.js's WAKE-ONLY TRUST MODEL
// identically: the only field read out of a payload is `channel_id` (wakeChannelId), and the
// listener answers by re-reading the roster over the authenticated API.
//
// INSERT *AND* UPDATE (2026-07-31). It used to bind INSERT alone, on the argument that a row
// APPEARING is the summon and every status flip is this machine's own write. That was only
// ever half true: DISENGAGE, PARK and DISMISS are UPDATEs, and the web UI (or a peer's
// machine, or this operator on another device) is what performs them. With no UPDATE binding
// the only thing that noticed was the 5-minute reconcile pass, so an agent went on taking
// untagged messages for up to five minutes after a person had told it to stop.
// Adding the binding costs nothing in trust: an UPDATE payload is treated EXACTLY like an
// INSERT one, as a routing key and nothing else, and the authenticated GET still decides what
// the roster now says. It is a second binding on the SAME table and filter, so it is
// authorized by the same RLS SELECT the INSERT one is — either both join or neither does,
// which is why it does not reintroduce the shared-channel hazard below.
// DELETE is deliberately NOT bound: `channel_agents` rows are retired by status, and a DELETE
// payload under the default replica identity carries the primary key only, so it would name
// no channel to re-read anyway.
//
// WHY A SEPARATE CHANNEL AND NOT A SECOND BINDING ON THE MESSAGE ONE. Realtime authorizes
// postgres_changes bindings at JOIN time and fails the WHOLE channel if any one of them is
// refused. Sharing would therefore make the message wake path — the core of the listener —
// depend on this table being published and readable on whatever server this build talks to.
// A desktop that ships ahead of its migration would silently drop every workspace back to the
// 45s long-poll. On its own channel, a refusal costs exactly the roster doorbell, and the
// reconcile pass (channel-agents.reconcileAll, every 5 minutes and on every wake) is already
// the backstop for it. A failure is logged once and left to that pass; there is no
// resubscribe ladder here, so it can never contribute to reconnect churn (F-072).

const { wakeChannelId, describeSubscribeError } = require('./realtime-core');
const { diag } = require('./diag');

const subs = new Map(); // wsId -> realtime channel (roster doorbell only)
let onChangeCb = null; // the listener's re-read hook, set by realtime.start

// The doorbell's one output. NOT coalesced through the message coalescer, because that one
// owns the message loop's wake and a roster read is a different (and far rarer) event.
// channel-agents.js is single-flight per channel, so a burst of roster changes costs at most
// one read in flight.
function onChange(wsId, op, payload) {
  const chId = wakeChannelId(payload);
  diag('realtime agent', op, String(wsId).slice(0, 8), 'ch', chId ? String(chId).slice(0, 8) : '-');
  try { if (chId && onChangeCb) onChangeCb(chId); } catch (_) { /* one doorbell must not kill the rest */ }
}

function setHandler(cb) {
  onChangeCb = typeof cb === 'function' ? cb : null;
}

function add(client, wsId) {
  if (!client || subs.has(wsId)) return;
  subs.set(wsId, null);
  const binding = (event) => ({
    event, schema: 'public', table: 'channel_agents', filter: `workspace_id=eq.${wsId}`,
  });
  try {
    const ch = client
      .channel(`dopl-desktop-agents:${wsId}`)
      .on('postgres_changes', binding('INSERT'), (payload) => onChange(wsId, 'insert', payload))
      .on('postgres_changes', binding('UPDATE'), (payload) => onChange(wsId, 'update', payload))
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') { diag('realtime agents sub', String(wsId).slice(0, 8), 'SUBSCRIBED'); return; }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          diag('realtime agents sub', String(wsId).slice(0, 8), status,
            `reason=${describeSubscribeError(err)}`,
            '- roster changes fall back to the reconcile pass; message push is unaffected');
        }
      });
    subs.set(wsId, ch);
  } catch (err) {
    diag('realtime agents subscribe failed', err && err.message);
  }
}

function remove(client, wsId) {
  const ch = subs.get(wsId);
  subs.delete(wsId);
  try { if (client && ch) client.removeChannel(ch); } catch (_) { /* already gone */ }
}

// Drop every doorbell (realtime.stop, and the reconcile pass's "no longer desired" sweep
// reads `joined()` to decide which ones those are).
function clear(client) {
  for (const wsId of Array.from(subs.keys())) remove(client, wsId);
  onChangeCb = null;
}

function joined() {
  return Array.from(subs.keys());
}

module.exports = { setHandler, add, remove, clear, joined };
