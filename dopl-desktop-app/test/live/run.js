'use strict';

// LIVE CONTRACT HARNESS — the runner.
//
//   npm run test:live            (from dopl-desktop-app/)
//   node test/live/run.js
//
// It posts REAL messages to the REAL API, reads them back through the REAL routes, drives
// the REAL MCP endpoint, and feeds each returned message through the REAL desktop decision
// modules — twice, once as the sender's machine and once as the peer's. It is NOT part of
// `npm test` (see the note in creds.js about the `.js` extension) because it needs a
// credential and the network.
//
// NO CREDENTIAL => CLEAN SKIP, exit 0, one clear line. CI and other agents are unaffected.
//
// TEST-CHANNEL DISCIPLINE: every run creates its own `harness-<stamp>` channel and deletes
// it at the end. The operator's real DM is refused outright. A cleanup that cannot complete
// is SHOUTED, never swallowed — a silent leftover is debris in a real workspace.
//
// ── REBUILT FOR THE SESSION MODEL (F-141) ──────────────────────────────────────────
// The old harness's trick was two NAMED AGENTS, both owned by the caller, in one throwaway
// channel — which is how it exercised addressing and multi-address without a second machine.
// Named agents are gone for good, so that trick goes with them and the setup is much
// smaller: post the traffic, read it back, and let the checks drive MCP and the routes
// directly. The one thing that survives is `myUserId` as a PARAMETER — the desktop modules
// take the operator's id as an argument, so the SAME real message evaluated with the peer's
// id IS the peer's machine.

const { readToken, redact, target, FORBIDDEN_CHANNEL_IDS } = require('./creds');
const { Api } = require('./api');
const { load } = require('./desktop');
const { FORGED } = require('./checks-contract');
const { CHECKS, CAP_WHY, PASS, FAIL, SKIP, readOf } = require('./checks');

const say = (...a) => console.log(redact(a.join(' ')));

// The two recognized X-Dopl-Runtime values (src/shared/auth/runtime-header.ts, and
// main/targeting.js DESKTOP_RUNTIMES). They are NOT interchangeable here:
//   desktop-session  credential-agnostic by design — a spawned session presents exactly the
//                    device token this harness holds, so this one MUST stamp.
//   desktop-ui       "a person typed this" — narrowRuntime REFUSES it for an agent
//                    credential, so from this harness it MUST NOT stamp.
// Check 6 sends both and asserts the asymmetry.
const RUNTIME_STAMP = 'desktop-session';
const RUNTIME_SPOOF = 'desktop-ui';

async function main() {
  const cred = readToken();
  if (!cred.token) {
    say(`SKIP live contract harness — ${cred.reason}.`);
    say('       Set DOPL_TOKEN, or sign in to the Dopl desktop app, then re-run.');
    return 0;
  }
  const tg = target();
  const api = new Api({ baseUrl: tg.baseUrl, token: cred.token, workspaceId: tg.workspaceId });

  say(`live contract harness — ${tg.baseUrl}  workspace ${tg.workspaceId}  (credential from ${cred.source})`);

  // ── preflight: VERIFY the identity and the workspace rather than assuming them ──
  const who = await api.whoami();
  if (who.userId !== tg.expectUserId) {
    say(`ABORT: this token authenticates as ${who.userId}, not the expected ${tg.expectUserId}.`);
    say('       Every ownership assertion below would be meaningless. Set DOPL_EXPECT_USER_ID to override.');
    return 2;
  }
  if (!who.workspace || who.workspace.id !== tg.workspaceId) {
    say(`ABORT: X-Workspace-Id ${tg.workspaceId} resolved to ${who.workspace && who.workspace.id}.`);
    return 2;
  }
  say(`identity ok — ${who.userId} in "${who.workspace.name}" (${who.workspace.slug}), role ${who.role}`);

  const dsk = await load();
  for (const n of dsk.notes) say(`NOTE: ${n}`);

  // The operator's own desktop reacts to everything this harness posts. Say so.
  say('NOTE: if the Dopl desktop app is running on this Mac it WILL react to this channel —');
  say('      an addressed post opens a parked session window. Sessions start at ask, so no');
  say('      agent turn runs without an Accept.');

  const ctx = {
    api,
    dsk,
    workspaceId: tg.workspaceId,
    me: who.userId,
    stamp: tg.stamp,
    runtimeStamp: RUNTIME_STAMP,
    msg: {},
    caps: {},
    cleanup: [],
  };
  let code = 0;
  try {
    await setup(ctx, who, tg);
    code = await report(ctx);
  } finally {
    await teardown(ctx);
  }
  return code;
}

// ── setup: build the room, post the traffic, read it back ────────────────────────

async function setup(ctx, who, tg) {
  const { api } = ctx;

  // The peer. A thread cannot be addressed to its own creator, and "the peer's machine" is
  // a more honest evaluation with a real member id than with an invented one.
  ctx.peer = tg.peerUserId;
  if (!ctx.peer) {
    const list = await api.request('GET', `/api/workspaces/${who.workspace.slug}/members`);
    const members = (list.json && list.json.members) || [];
    const other = members.find((m) => m.userId && m.userId !== ctx.me && m.status !== 'invited');
    ctx.peer = other ? other.userId : '';
    ctx.peerLabel = other ? `${other.displayName || other.email} (${other.userId})` : '';
  }
  if (!ctx.peer) {
    ctx.peer = '00000000-0000-4000-8000-000000000000'; // a synthetic non-member machine
    ctx.peerLabel = 'synthetic (no second workspace member found)';
    ctx.threadSkip = 'no second workspace member: a thread cannot be addressed to its own creator';
  }
  say(`peer machine id — ${ctx.peerLabel || ctx.peer}`);

  const name = `harness-${tg.stamp}`;
  const created = await api.createChannel(name, 'live contract harness — safe to delete');
  ctx.channel = created.channel || created;
  if (FORBIDDEN_CHANNEL_IDS.has(ctx.channel.id)) throw new Error("refusing to operate on the operator's real DM");
  ctx.cleanup.push({ what: `channel ${ctx.channel.id}`, run: () => api.deleteChannel(ctx.channel.id) });
  say(`channel — ${ctx.channel.id} "${ctx.channel.name}" (slug ${ctx.channel.slug})`);

  if (!ctx.threadSkip) {
    const added = await api.addMember(ctx.channel.id, ctx.peer);
    if (!added.ok) {
      ctx.threadSkip = `could not add the peer to the harness channel: HTTP ${added.status} ${added.text.slice(0, 200)}`;
      say(`NOTE: ${ctx.threadSkip}`);
    }
  }

  // ── the traffic ───────────────────────────────────────────────────────────────
  //
  // `authorKind: 'user'` IS LOAD-BEARING. The device token is an AGENT credential and the
  // service derives `agent` from it when the field is omitted — so every post would be
  // agent-authored, the loop brake would refuse everything, and the contract checks would
  // pass vacuously against a room where nothing could ever route. A human TYPING in the
  // composer posts over a cookie session as `user`, and that is the row shape reproduced
  // here. Whether the server HONOURED the claim is never assumed: check 13 re-reads
  // `authorKind` off the stored row and SKIPs if the server derived something else.
  //
  // `chat` and `control` are the SAME post but for one field: `control` omits `intent`
  // entirely. Check 12 needs both, because "the intent came back" is only evidence about
  // the caller's field if the otherwise-identical post without it came back clean. The
  // control is also what arms check 13 — an unaddressed HUMAN post is the shape classify
  // answers 'trigger' for, so it proves the room can trigger at all before check 13 claims
  // the loop brake is what stopped the agent-authored twin.
  const posted = {};
  posted.chat = await must(
    api.post(ctx.channel.id, {
      body: 'live harness: human aside with an intent. Automated probe, no action needed.',
      authorKind: 'user',
      intent: 'chat',
      clientMsgId: `harness-${tg.stamp}-chat`,
    }),
    'post chat'
  );
  posted.control = await must(
    api.post(ctx.channel.id, {
      body: 'live harness: the control — same shape, NO intent. Automated probe, no action needed.',
      authorKind: 'user',
      clientMsgId: `harness-${tg.stamp}-control`,
    }),
    'post control'
  );
  posted.agentNoise = await must(
    api.post(ctx.channel.id, {
      body: 'live harness: an agent talking to the room, addressed to nobody.',
      authorKind: 'agent',
      clientMsgId: `harness-${tg.stamp}-noise`,
    }),
    'post agent-noise'
  );

  // THE FORGERY (check 11). Every reserved key at once — the mutation that proved this gap
  // deleted ONE `delete metadata.x` line, so probing one key at a time would have missed it.
  // Posted SOFT: a server that refuses the shape outright SKIPs check 11 rather than
  // aborting the twelve checks that have nothing to do with it.
  const forged = await api.post(ctx.channel.id, {
    body: 'live harness: a post forging every reserved metadata key. Automated probe, no action needed.',
    authorKind: 'user',
    metadata: { ...FORGED },
    clientMsgId: `harness-${tg.stamp}-forged`,
  });
  if (forged.ok) posted.forged = forged.json.message;
  else ctx.forgedError = `HTTP ${forged.status} ${forged.text.slice(0, 300)}`;

  // THE RUNTIME STAMP (check 6). Sent as a HEADER, which is the only way the stamp is ever
  // set — `metadata.runtime` is stripped, so a metadata-borne stamp would prove nothing.
  const stamped = await api.post(
    ctx.channel.id,
    {
      body: 'live harness: a post carrying the desktop-session runtime header. Automated probe, no action needed.',
      authorKind: 'user',
      clientMsgId: `harness-${tg.stamp}-stamped`,
    },
    { headers: { 'X-Dopl-Runtime': RUNTIME_STAMP } }
  );
  if (stamped.ok) posted.stamped = stamped.json.message;
  else ctx.stampedError = `HTTP ${stamped.status} ${stamped.text.slice(0, 300)}`;

  // THE SPOOF, and the reason check 6 is an asymmetry rather than a single assertion. This
  // credential is a device token — an AGENT credential — claiming "a person typed this in
  // the app". `narrowRuntime` must refuse to stamp it. The post itself is expected to
  // SUCCEED; it is the STAMP that must not land.
  const spoofed = await api.post(
    ctx.channel.id,
    {
      body: 'live harness: an agent credential claiming the desktop-ui stamp. Automated probe, no action needed.',
      authorKind: 'user',
      clientMsgId: `harness-${tg.stamp}-spoof`,
    },
    { headers: { 'X-Dopl-Runtime': RUNTIME_SPOOF } }
  );
  if (spoofed.ok) posted.spoofedRuntime = spoofed.json.message;
  else ctx.spoofError = `HTTP ${spoofed.status} ${spoofed.text.slice(0, 300)}`;

  // ── A THREAD, for the tasks/{taskId} route ────────────────────────────────────
  if (!ctx.threadSkip) {
    const res = await api.createThread(ctx.channel.id, {
      title: 'harness: route coverage',
      body: 'live contract harness — automated probe, no action needed.',
      toUserId: ctx.peer,
      clientMsgId: `harness-${tg.stamp}-thread`,
    });
    if (res.ok) {
      ctx.thread = res.json.task;
      // NO CLEANUP STEP FOR THE THREAD, and this is not an oversight. CLOSING A THREAD IS
      // HUMAN-ONLY (`CHANNEL_CLOSE_IS_HUMAN_ONLY`): an agent may propose a close, a person
      // confirms it, and this harness holds an agent credential. The first version
      // registered a `closeThread` teardown step and every run ended by SHOUTING that it
      // had left a thread behind — the server refusing exactly as designed, reported as
      // harness debris. Deleting the CHANNEL takes its threads with it, which is why the
      // channel step is the only one needed.
    } else {
      say(`NOTE: create_thread refused: HTTP ${res.status} ${res.text.slice(0, 300)}`);
    }
  }

  // ── READ IT ALL BACK. Nothing above is used as a fixture; the checks only ever see
  //    what the server hands back through the routes the desktop itself calls. ──────
  ctx.channel = (await api.getChannel(ctx.channel.id)).channel || ctx.channel;
  const all = await api.messages(ctx.channel.id, 0);
  const bySeq = new Map(all.map((m) => [m.seq, m]));
  for (const [k, v] of Object.entries(posted)) {
    const back = bySeq.get(v.seq);
    if (!back) throw new Error(`posted "${k}" at seq ${v.seq} but the read did not return it`);
    ctx.msg[k] = back;
  }
  ctx.lastSeq = Math.max(0, ...all.map((m) => Number(m.seq) || 0));

  // ── WHAT THIS WIRE COULD ACTUALLY DO, probed off the run just produced ───────
  // Not a version string and not a guess: each one asks "did the field the desktop reads
  // actually come back". The day the wave deploys, the gated checks arm themselves.
  ctx.caps.intent = (ctx.msg.chat.metadata || {}).intent === 'chat';
  ctx.caps.thread_participants = !!ctx.thread;

  say(`wire — ${all.length} messages, memberCount ${ctx.channel.memberCount}${ctx.thread ? ', 1 thread' : ''}`);
  if (ctx.forgedError) say(`NOTE: the forged post was refused — ${ctx.forgedError}`);
  if (ctx.stampedError) say(`NOTE: the runtime-stamped post was refused — ${ctx.stampedError}`);
  say('');
}

async function must(p, what) {
  const res = await p;
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${res.text.slice(0, 400)}`);
  return res.json.message || res.json;
}

// ── report ───────────────────────────────────────────────────────────────────────

async function report(ctx) {
  let failed = 0;
  let skipped = 0;
  say('CONTRACT CHECKS');
  for (const c of CHECKS) {
    let r;
    try {
      r = await c.run(ctx);
    } catch (err) {
      r = { status: FAIL, reason: `threw: ${err && err.message}` };
    }
    say(`  ${pad(r.status)} ${c.id}. ${c.title}`);
    if (r.status === FAIL) failed += 1;
    if (r.status === SKIP) skipped += 1;
    if (r.status === SKIP && r.reason) say(`         reason: ${r.reason}`);
    if (r.status === FAIL) {
      if (r.reason) say(`         ${r.reason}`);
      if (r.wire) say(`         server-said  ${r.wire}`);
      for (const [who, d] of Object.entries(r.both || {})) {
        say(`         desktop-read ${who.padEnd(4)} ${readOf(d)}`);
      }
    }
    for (const line of r.extraLines || []) say(`         ${line}`);
  }
  say('');
  say(`${CHECKS.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped — ${ctx.api.calls} live calls`);
  return failed ? 1 : 0;
}

const pad = (s) => (s === PASS ? 'PASS' : s === FAIL ? 'FAIL' : 'SKIP');

// ── teardown ─────────────────────────────────────────────────────────────────────

async function teardown(ctx) {
  const leftovers = [];
  for (const step of ctx.cleanup.reverse()) {
    try {
      const res = await step.run();
      if (res && res.ok === false) leftovers.push(`${step.what}: HTTP ${res.status} ${String(res.text).slice(0, 200)}`);
    } catch (err) {
      leftovers.push(`${step.what}: ${err && err.message}`);
    }
  }
  if (leftovers.length) {
    say('');
    say('!! CLEANUP INCOMPLETE — the following were left behind in a real workspace:');
    for (const l of leftovers) say(`   ${l}`);
  } else if (ctx.cleanup.length) {
    say('cleanup ok — harness channel and thread removed');
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    say(`HARNESS ERROR: ${err && err.message}`);
    if (err && err.stack) say(String(err.stack).split('\n').slice(1, 5).join('\n'));
    process.exit(2);
  });
