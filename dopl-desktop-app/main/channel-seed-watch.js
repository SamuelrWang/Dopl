// Seeds a channel THIS ACCOUNT created without a renderer (an agent over MCP) from the operator's
// defaults, from the reconcile pass that first sees it (`channel-listener.js › reconcileInner`).
// It only ever WRITES a channel's own posture, once, through `agentDefaults.seedChannel` (write-once),
// and never reads the defaults at a spawn. A channel is seeded when: `isMember === true`,
// `createdBy` is the resolved operator (unresolved = nothing), `createdAt` is newer than the
// first-seen watermark, and it has no posture yet (checked by `seedChannel`).
// "No posture yet" alone is NOT the signal — most existing rooms have none. The watermark is in the
// SERVER's clock (`createdAt`); the local clock stands in only for an install pass that saw no rows.
// Known gap (P3-19): one watermark over workspaces listed seconds apart can skip a room created
// mid-pass — a denial (it stays at the factory posture), never a widening.

const Store = require('electron-store');
const agentDefaults = require('./agent-defaults');
const { diag } = require('./diag');

const store = new Store();

// ─── BEGIN SEED-WATCH-DECIDE (pure; unit-tested via source extraction) ──

const WATERMARK_V = 1;

/** A server timestamp as epoch ms, or NaN (NaN never seeds). */
function stampMs(raw) {
  if (typeof raw !== 'string' || raw === '') return NaN;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : NaN;
}

/** The stored watermark, or null: a corrupt record re-runs the INSTALL pass (seeds nothing), never epoch. */
function readWatermark(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.v !== WATERMARK_V) return null;
  const ms = stampMs(raw.at);
  return Number.isNaN(ms) ? null : { at: raw.at, ms: ms };
}

/** One pass's rows with their two row gates; a row with no id or no parseable stamp is dropped whole. */
function seenRows(channels, selfUserId) {
  const rows = [];
  for (const c of Array.isArray(channels) ? channels : []) {
    if (!c || !c.id) continue;
    const ms = stampMs(c.createdAt);
    if (Number.isNaN(ms)) continue;
    rows.push({
      id: String(c.id),
      ms: ms,
      at: c.createdAt,
      // Absent `isMember` / `createdBy` or an unresolved self are each "no".
      member: c.isMember === true,
      mine: !!selfUserId && c.createdBy === selfUserId,
    });
  }
  return rows;
}

/**
 * One reconcile pass → `{ install, seed, advance, rows }`: `install` writes the first watermark and
 * seeds NOTHING (every existing room sits at or below it); `seed` is the ids to hand `seedChannel`,
 * oldest first, judged against the pass-START watermark; `advance` raises it afterwards. Only a
 * COMPLETE pass installs or advances, and the watermark never moves backward.
 */
function decidePass(input) {
  const complete = input && input.complete === true;
  const watermark = (input && input.watermark) || null;
  const rows = seenRows(input && input.channels, input && input.selfUserId);
  const newest = rows.reduce((mx, r) => Math.max(mx, r.ms), -Infinity);
  if (!watermark) {
    if (!complete) return { install: null, seed: [], advance: null, rows: rows };
    // The local clock only when there is no server value to take.
    const at = rows.length ? newest : Number(input && input.nowMs);
    return {
      install: Number.isFinite(at) ? at : null,
      seed: [], advance: null, rows: rows,
    };
  }
  const seed = rows
    .filter((r) => r.member && r.mine && r.ms > watermark.ms)
    .sort((a, b) => a.ms - b.ms)
    .map((r) => r.id);
  const advance = complete && rows.length && newest > watermark.ms ? newest : null;
  return { install: null, seed: seed, advance: advance, rows: rows };
}

// ─── END SEED-WATCH-DECIDE ─────

const WATERMARK_KEY = 'channelSeedWatermark'; // { v, at }

function storedWatermark() {
  try {
    return readWatermark(store.get(WATERMARK_KEY));
  } catch (_err) {
    return null; // an unreadable store re-takes the boundary; it never seeds against a guess
  }
}

function writeWatermark(ms) {
  try {
    store.set(WATERMARK_KEY, { v: WATERMARK_V, at: new Date(ms).toISOString() });
    return true;
  } catch (err) {
    diag('seed-watch: could not persist the watermark —', err && err.message);
    return false;
  }
}

/**
 * Observe one reconcile pass. Its only caller is `channel-listener.js` (the suite pins the census:
 * a spawn-path caller would smuggle the defaults into a launch). `desired` is the pass's
 * id → `{ channel, … }` map; `complete` = every workspace answered. Seeds FIRST, advances second, so
 * a crash between them costs a repeated pass, never a skipped channel.
 */
function observeChannels(desired, complete, selfUserId) {
  const channels = [];
  try {
    for (const d of (desired && typeof desired.values === 'function' ? desired.values() : [])) {
      if (d && d.channel) channels.push(d.channel);
    }
  } catch (_err) { /* a malformed pass observes nothing */ }
  const res = decidePass({
    channels: channels,
    complete: complete === true,
    selfUserId: selfUserId || null,
    watermark: storedWatermark(),
    nowMs: Date.now(),
  });
  if (res.install != null) {
    if (writeWatermark(res.install)) {
      diag('seed-watch: first-seen watermark installed at', new Date(res.install).toISOString(),
        'over', res.rows.length, 'channel(s) — nothing seeded, every existing room is below it');
    }
    return { installed: true, seeded: [] };
  }
  const seeded = [];
  for (const id of res.seed) {
    let out = null;
    try {
      out = agentDefaults.seedChannel(id);
    } catch (err) {
      diag('seed-watch: seed threw', String(id).slice(0, 8), '—', err && err.message);
    }
    if (out && out.seeded) {
      seeded.push(id);
      diag('seed-watch: inherited defaults into', String(id).slice(0, 8),
        '— created by this account after the watermark');
    }
  }
  if (res.advance != null) writeWatermark(res.advance);
  return { installed: false, seeded: seeded };
}

module.exports = { observeChannels };
