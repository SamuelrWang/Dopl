// SEED A CHANNEL **THIS MACHINE DID NOT CREATE IN A RENDERER** FROM THE OPERATOR'S DEFAULTS —
// the second and last inheritance point (2026-09-22, Samuel's ruling: *"Agent created channels
// should inherit defaults."*).
//
// ── ⚠ WHAT THIS IS NOT: A SPAWN-TIME READ OF THE DEFAULTS RECORD ────────────────────────────
//
// Read `agent-defaults.js`'s header and `channel-prefs.js`'s H2 block before touching this file.
// The ruling REVERSES the *reach* of the seed and NOTHING about its shape:
//
//   · this module still only ever **WRITES** a channel's OWN posture, once, through
//     `agentDefaults.seedChannel` — the single validating writer the census in
//     `test/session-posture-writers.test.mjs` pins;
//   · `getAgentDefaults` is **not** called here and must never be. It is not wired into
//     `session-engine.js`, `session-launch.js` or `getLaunchPosture`'s fallback, so every later
//     read is still the per-channel record through the ONE consumer that already existed
//     (`session-launch-op.js`, the operator's own Launch button);
//   · `seedChannel` is still WRITE-ONCE — it refuses a channel that already has a posture — so a
//     re-created row, a retry, two racing passes or a channel the operator has since configured
//     cannot be rewritten. "Existing channels untouched" stays a property of that function;
//   · the defaults record stays LOCAL (Samuel, 2026-09-18). Nothing here POSTs it, names it in a
//     channel message, or asks the server to apply it. **The seed is applied by the operator's
//     own machine**, which is the only reason a local record can reach a server-side creation.
//
// ── ⚠ THE PROBLEM THIS FILE EXISTS FOR ──────────────────────────────────────────────────────
//
// A channel created over MCP by an agent is created SERVER-SIDE. No renderer runs, so
// `features/channels/lib/agent-defaults-seed.ts` — the renderer seam, which fires inside a
// creation a human just performed — is never reached. The desktop has to NOTICE the channel
// instead. It already does: `channel-listener.js › reconcileInner` enumerates every channel in
// every workspace the operator is a member of and starts a loop for each. That pass is the seam,
// and it is the one this module hangs off. Nothing new polls, and nothing new asks the server.
//
// ── ⚠ **WHEN** THE SEED FIRES, AND WHY EACH GATE IS THERE ───────────────────────────────────
//
// On a reconcile pass, a channel is seeded when ALL FOUR hold:
//
//   1. `isMember === true` — MEMBERSHIP CONFIRMED. The list can carry a workspace-visible room
//      this operator has not joined; seeding one would configure a room they are not in.
//   2. `createdBy === <this operator's user id>` — CREATED BY **THIS ACCOUNT**. An agent creating
//      over MCP authenticates as its operator, so `channels.created_by` is the operator's id
//      (`features/channels/server/service-writes-channel.ts › created_by: ctx.userId`). This is
//      what the ruling means by "agent created": a room THIS account brought into existence,
//      whether by a human in a dialog or by that human's agent over MCP. A room a PEER created
//      and added the operator to is not that, and does not inherit. ⚠ Fail-closed: an
//      unresolved identity (`myUserId === null`) seeds nothing.
//   3. `createdAt` is STRICTLY NEWER than the first-seen watermark — see below. This is the gate
//      that keeps the ruling from rewriting rooms that existed before the feature.
//   4. the channel has no posture of its own — enforced inside `seedChannel`, not here, so it
//      holds for every caller and not just this one.
//
// ── ⚠ **THE WATERMARK** — HOW A NEW CHANNEL IS TOLD FROM A PRE-EXISTING ONE ──────────────────
//
// 🔒 **"HAS NO POSTURE YET" IS NOT THE SIGNAL, AND USING IT WOULD BE THE BUG.** It is true of
// every channel an operator has never opened Settings for — which is most of them — so a
// machine with 50 unconfigured rooms would have all 50 silently stamped with the profile
// defaults on the next launch. That is the failure this record exists to prevent.
//
// The signal is a per-machine WATERMARK, in the SERVER'S OWN CLOCK:
//
//   INSTALL   The first COMPLETE pass (every workspace enumerated — a workspace that never
//             answered makes the pass incomplete and is not a boundary) writes the watermark as
//             the MAXIMUM `createdAt` of every channel it could see, and **seeds nothing**. Every
//             room that existed at that moment is therefore at-or-below the boundary forever.
//   ADVANCE   Every later COMPLETE pass raises the watermark to the newest `createdAt` it saw.
//             It NEVER moves backward. The record means "this machine has observed the world up
//             to here", so a room the operator is added to LATER but which was created EARLIER is
//             below the boundary and does not inherit — which is the honest answer: it is not new.
//   DECIDE    Every channel in a pass is decided against the watermark AS IT STOOD WHEN THE PASS
//             STARTED, and the advance happens after. Deciding row-by-row against a running max
//             would let the newest room in a pass hide a slightly older sibling created in the
//             same window.
//
// ⚠ **WHY A SERVER STAMP AND NOT THE LOCAL CLOCK.** `createdAt` is written by Postgres and the
// watermark is derived from those same values, so the comparison never crosses clocks and machine
// skew cannot move the boundary. The ONE exception is an install pass that saw NO channels at
// all: there is no server value to take, so the local clock stands in. In that case there is by
// construction nothing pre-existing to protect, and skew can only cost a room the operator is
// added to inside the skew window — never a widening of one they already had.
//
// ⚠ **WHAT THE WATERMARK CANNOT DO, STATED HONESTLY.** A row whose `createdAt` is far in the
// FUTURE drags the boundary with it and stalls later inheritance until real time catches up.
// That is a DENIAL (rooms stay at the restrictive factory pair), never a widening, and
// `channels.created_at` is a column default no API caller can set — so it is recorded here rather
// than defended against with a clamp that would add a second clock.
//
// ── ⚠ TWO DESKTOPS, ONE NEW CHANNEL ─────────────────────────────────────────────────────────
//
// TWO MACHINES OF THE SAME OPERATOR both pass gate 2, so each seeds ITS OWN local defaults into
// ITS OWN local per-channel record. That is correct and not a race: the record is per-machine by
// construction (electron-store, never synced), the two machines may legitimately hold different
// defaults, and neither write is visible to the other. Each machine's `seedChannel` is write-once
// against its own store.
//
// TWO DIFFERENT MEMBERS' desktops: only the CREATOR'S machine seeds. The other member's room
// stays at the factory manual/ask pair until they configure it — a peer's profile defaults have
// never been allowed to decide what this operator's agents may do, and gate 2 is what keeps that
// true now that a channel can arrive without a local creation.
//
// PRIVACY — local electron-store only, like the two records it stands between. The diag line
// carries a channel id PREFIX and a count; there is no free text in it to leak.

const Store = require('electron-store');
const agentDefaults = require('./agent-defaults');
const { diag } = require('./diag');

const store = new Store();

// ─── BEGIN SEED-WATCH-DECIDE (pure; unit-tested via source extraction) ──
// No electron/store/fs/require refs below, so test/channel-seed-watch.test.mjs can slice this
// block and evaluate it verbatim — the same fence `agent-defaults.js` and `listener-io.js` use.
// Everything that decides WHETHER a channel inherits lives in here; the impure half below only
// reads the store, calls the one writer, and logs.

const WATERMARK_V = 1;

/** A server timestamp as epoch ms, or NaN. ⚠ Anything unparseable is NaN and NaN never seeds. */
function stampMs(raw) {
  if (typeof raw !== 'string' || raw === '') return NaN;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * The stored watermark, or null when there is none THIS BUILD CAN TRUST.
 *
 * ⚠ A corrupt, wrong-version or unparseable record reads as ABSENT, which re-runs the INSTALL
 * pass — i.e. it re-takes the boundary from the world as it stands and seeds nothing. That is the
 * fail-closed direction: the alternative reading (treat it as epoch) would seed every channel the
 * operator has ever created.
 */
function readWatermark(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.v !== WATERMARK_V) return null;
  const ms = stampMs(raw.at);
  return Number.isNaN(ms) ? null : { at: raw.at, ms: ms };
}

/**
 * NORMALIZE ONE PASS'S CHANNELS — id, server stamp, and the two gates that are properties of the
 * ROW rather than of the boundary. A row with no id or no parseable stamp is DROPPED whole: it
 * can neither be seeded nor move the watermark, because both would rest on a value this build
 * could not read.
 */
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
      // ⚠ BOTH GATES ARE `=== ` AGAINST A RESOLVED VALUE. An absent `isMember`, an absent
      // `createdBy`, or an unresolved operator identity are each "no", never "probably".
      member: c.isMember === true,
      mine: !!selfUserId && c.createdBy === selfUserId,
    });
  }
  return rows;
}

/**
 * THE WHOLE DECISION FOR ONE RECONCILE PASS — `{ install, seed, advance, rows }`.
 *
 * `install` (ms | null)  write this watermark and seed NOTHING — the migration boundary.
 * `seed`    (id[])       channels to hand `seedChannel`, oldest first.
 * `advance` (ms | null)  raise the watermark to here AFTER the seeds have been attempted.
 *
 * ⚠ **THE INSTALL PASS NEVER SEEDS**, which is the entire answer to "an operator with 50 existing
 * unconfigured channels must not have them all silently seeded on the next launch". On the first
 * complete pass every channel that exists is, by definition, at-or-below the boundary being
 * written — so the pass that learns the boundary cannot also act on it.
 * ⚠ **ONLY A COMPLETE PASS MOVES THE BOUNDARY.** A pass with an unenumerated workspace is not a
 * picture of the world, and taking a boundary from it would put every room in that workspace
 * permanently below a line drawn without them. Seeding, by contrast, is safe on an incomplete
 * pass: the rows it did see are membership-confirmed facts.
 * ⚠ **THE WATERMARK NEVER MOVES BACKWARD** — `Math.max` against the stored value, not assignment.
 */
function decidePass(input) {
  const complete = input && input.complete === true;
  const watermark = (input && input.watermark) || null;
  const rows = seenRows(input && input.channels, input && input.selfUserId);
  const newest = rows.reduce((mx, r) => Math.max(mx, r.ms), -Infinity);
  if (!watermark) {
    if (!complete) return { install: null, seed: [], advance: null, rows: rows };
    // ⚠ THE LOCAL CLOCK STANDS IN ONLY WHEN THERE IS NO SERVER VALUE TO TAKE — see the header.
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
 * OBSERVE ONE RECONCILE PASS. Called from `channel-listener.js › reconcileInner` and from
 * nowhere else — `test/channel-seed-watch.test.mjs` pins the require census, because a caller on
 * a spawn path would be this module smuggling the defaults record into a launch.
 *
 * `desired` is that pass's map (channel id -> `{ channel, workspaceId, workspaceSegment }`);
 * `complete` says every workspace answered; `selfUserId` is the resolved operator identity.
 *
 * ⚠ **SEEDS FIRST, ADVANCES SECOND.** A crash between the two costs a repeated pass, which is
 * free (`seedChannel` is write-once); the other order would move the boundary past a channel that
 * was never seeded.
 * ⚠ Returns a small report for the tests and for the diag line; it is never a posture.
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

module.exports = {
  WATERMARK_KEY,
  WATERMARK_V,
  stampMs,
  readWatermark,
  seenRows,
  decidePass,
  observeChannels,
};
