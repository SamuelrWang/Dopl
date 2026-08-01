'use strict';

// LIVE CONTRACT HARNESS — the runner.
//
//   npm run test:live            (from dopl-desktop-app/)
//   node test/live/run.js
//
// It posts REAL messages to the REAL API, reads them back through the REAL routes, and
// feeds each returned message through the REAL desktop decision modules — twice, once as
// the sender's machine and once as the peer's. It is NOT part of `npm test` (see the note
// in creds.js about the `.js` extension) because it needs a credential and the network.
//
// NO CREDENTIAL => CLEAN SKIP, exit 0, one clear line. CI and other agents are unaffected.
//
// TEST-CHANNEL DISCIPLINE: every run creates its own `harness-<stamp>` channel and deletes
// it at the end. The operator's real DM is refused outright. A cleanup that cannot complete
// is SHOUTED, never swallowed — a silent leftover is debris in a real workspace.
//
// KEY INSIGHT: two agents, both owned by the caller, in one throwaway channel. That
// exercises addressing, multi-address, threading, the handshake and delivery without a
// second machine. Where a rule genuinely depends on the OTHER member, the SAME real
// message is evaluated with `myUserId` set to the peer's id — the desktop modules take it
// as a parameter, so the peer's machine is one argument away.

const { readToken, redact, target, FORBIDDEN_CHANNEL_IDS } = require('./creds');
const { Api } = require('./api');
const { load } = require('./desktop');
const { CHECKS, CAP_WHY, PASS, FAIL, SKIP, readOf } = require('./checks');

const say = (...a) => console.log(redact(a.join(' ')));

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
  say('      it greets the harness agents and opens a parked session window per addressed post.');
  say('      Team sessions start at ask, so no agent turn runs without an Accept.');

  const ctx = { api, dsk, workspaceId: tg.workspaceId, me: who.userId, msg: {}, cleanup: [] };
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

  // The peer. Needed for two reasons: a thread cannot be addressed to its own creator
  // (TaskSelfTargetError), and "the peer's machine" is a more honest evaluation with a real
  // member id than with an invented one.
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
  if (FORBIDDEN_CHANNEL_IDS.has(ctx.channel.id)) throw new Error('refusing to operate on the operator\'s real DM');
  ctx.cleanup.push({ what: `channel ${ctx.channel.id}`, run: () => api.deleteChannel(ctx.channel.id) });
  say(`channel — ${ctx.channel.id} "${ctx.channel.name}" (slug ${ctx.channel.slug})`);

  if (!ctx.threadSkip) {
    const added = await api.addMember(ctx.channel.id, ctx.peer);
    if (!added.ok) {
      ctx.threadSkip = `could not add the peer to the harness channel: HTTP ${added.status} ${added.text.slice(0, 200)}`;
      say(`NOTE: ${ctx.threadSkip}`);
    }
  }

  // TWO agents, both MINE. This is the whole trick.
  const a = await api.summonAgent(ctx.channel.id, 'hxa');
  const b = await api.summonAgent(ctx.channel.id, 'hxb');
  if (!a.ok || !b.ok) {
    throw new Error(`summon failed: a=HTTP ${a.status} ${a.text.slice(0, 200)} b=HTTP ${b.status} ${b.text.slice(0, 200)}`);
  }
  ctx.agents = { a: a.json.agent, b: b.json.agent };
  const handles = new Map([[ctx.agents.a.id, ctx.agents.a.name], [ctx.agents.b.id, ctx.agents.b.name]]);
  ctx.name = (id) => handles.get(id) || String(id || '').slice(0, 8);
  say(`agents — @${ctx.agents.a.name} ${ctx.agents.a.id}  /  @${ctx.agents.b.name} ${ctx.agents.b.id}`);

  // ── the traffic, in the order that makes the checks bite ──────────────────────
  // The addressed posts go FIRST so both agents are ENGAGED server-side by the time the
  // chat post lands: without the chat brake, an engaged agent takes that post, so check 1
  // tests the brake rather than an empty room.
  //
  // `authorKind: 'user'` IS LOAD-BEARING. The device token is an AGENT credential and the
  // service derives `agent` from it when the field is omitted — so every post would be
  // agent-authored, the loop brake would refuse everything, and checks 1/2/4 would pass
  // vacuously against a room where nothing could ever route. A human TYPING in the composer
  // posts over a cookie session as `user`, and that is the row shape being reproduced.
  const posted = {};
  posted.one = await must(api.post(ctx.channel.id, {
    body: `@${ctx.agents.a.name} live harness: single address`,
    authorKind: 'user',
    intent: 'chat',
    toAgent: ctx.agents.a.name,
    clientMsgId: `harness-${tg.stamp}-one`,
  }), 'post one-address');
  posted.two = await must(api.post(ctx.channel.id, {
    body: `@${ctx.agents.a.name} @${ctx.agents.b.name} live harness: work together`,
    authorKind: 'user',
    intent: 'chat',
    toAgents: [ctx.agents.a.name, ctx.agents.b.name],
    clientMsgId: `harness-${tg.stamp}-two`,
  }), 'post two-address');
  posted.chat = await must(api.post(ctx.channel.id, {
    body: 'live harness: human aside, addressed to nobody',
    authorKind: 'user',
    intent: 'chat',
    clientMsgId: `harness-${tg.stamp}-chat`,
  }), 'post chat');
  posted.agentNoise = await must(api.post(ctx.channel.id, {
    body: 'live harness: an agent talking to the room, addressed to nobody',
    authorKind: 'agent',
    authorAgentId: ctx.agents.a.id,
    clientMsgId: `harness-${tg.stamp}-noise`,
  }), 'post agent-noise');

  ctx.handshakeSeq = posted.two.seq;

  // ── THREADS. Three, because they answer three different questions ─────────────
  //   derived  the handshake key ALONE, no `participants` — does the SERVER derive the set?
  //   slug     the same key built from the SLUG — the open blocker, pinned either way.
  //   room     an explicitly seeded breakout room — the delivery lane (check 6), which must
  //            not depend on whether derivation is deployed.
  const openBody = 'live contract harness — automated probe, no action needed.';
  if (!ctx.threadSkip) {
    ctx.derivedThread = await openThread(ctx, api, {
      title: 'harness: derived handshake',
      body: openBody,
      toUserId: ctx.peer,
      clientMsgId: `thread-open-${ctx.channel.id}-${ctx.handshakeSeq}`,
    });
    ctx.derivedParticipants = ctx.derivedThread ? await participantsOf(api, ctx, ctx.derivedThread) : null;

    ctx.slugThread = await openThread(ctx, api, {
      title: 'harness: slug-form handshake',
      body: openBody,
      toUserId: ctx.peer,
      clientMsgId: `thread-open-${ctx.channel.slug}-${ctx.handshakeSeq}`,
    });
    ctx.slugParticipants = ctx.slugThread ? await participantsOf(api, ctx, ctx.slugThread) : null;

    ctx.room = await openThread(ctx, api, {
      title: 'harness: breakout room',
      body: openBody,
      toUserId: ctx.peer,
      clientMsgId: `harness-${tg.stamp}-room`,
      participants: [
        { kind: 'agent', id: ctx.agents.a.id },
        { kind: 'agent', id: ctx.agents.b.id },
      ],
    });
    ctx.roomParticipants = ctx.room ? await participantsOf(api, ctx, ctx.room) : null;

    if (ctx.room) {
      // A PARTICIPATING agent posting into the room with NO addressing anywhere — the
      // shape the thread lane exists for, and the write the handshake exists to make legal.
      const into = await api.post(ctx.channel.id, {
        body: 'live harness: a participating agent speaking inside the thread',
        authorKind: 'agent',
        authorAgentId: ctx.agents.b.id,
        metadata: { taskId: ctx.room.id },
        clientMsgId: `harness-${tg.stamp}-thread`,
      });
      if (into.ok) posted.threadPost = into.json.message;
      else ctx.threadPostError = `HTTP ${into.status} ${into.text.slice(0, 300)}`;
    }
  } else {
    ctx.roomSkip = ctx.threadSkip;
  }

  // ── READ IT ALL BACK. Nothing above is used as a fixture; the checks only ever see
  //    what the server hands back through the routes the desktop itself calls. ──────
  ctx.roster = await api.roster(ctx.channel.id);
  ctx.channel = (await api.getChannel(ctx.channel.id)).channel || ctx.channel;
  const all = await api.messages(ctx.channel.id, 0);
  const bySeq = new Map(all.map((m) => [m.seq, m]));
  for (const [k, v] of Object.entries(posted)) {
    const back = bySeq.get(v.seq);
    if (!back) throw new Error(`posted "${k}" at seq ${v.seq} but the read did not return it`);
    ctx.msg[k] = back;
  }
  ctx.engagedRows = ctx.roster.filter((r) => r.ownerUserId === ctx.me && r.engagedAt);

  // ── SERVER CAPABILITIES, probed off the wire this run just produced ───────────
  // Not a version string and not a guess: each one asks "did the field the desktop reads
  // actually come back". The day the wave deploys, the gated checks arm themselves.
  ctx.caps = {
    to_agent_ids: Array.isArray(ctx.msg.two.metadata.to_agent_ids),
    intent: ctx.msg.chat.metadata.intent === 'chat',
    engagement: ctx.roster.some((r) => Object.prototype.hasOwnProperty.call(r, 'engagedAt')),
    thread_participants: Array.isArray(ctx.roomParticipants),
    handshake_derivation: Array.isArray(ctx.derivedParticipants) && ctx.derivedParticipants.length > 0,
  };

  say(
    `wire — ${all.length} messages, roster ${ctx.roster.length} agents ` +
      `(${ctx.engagedRows.length} engaged), memberCount ${ctx.channel.memberCount}` +
      (ctx.room ? `, ${[ctx.derivedThread, ctx.slugThread, ctx.room].filter(Boolean).length} threads` : '')
  );
  say('');
  say('SERVER CAPABILITIES (probed live — a missing one SKIPS its checks, it does not fail them)');
  for (const [k, v] of Object.entries(ctx.caps)) {
    say(`  ${v ? 'yes' : 'NO '}  ${k}${v ? '' : `  — ${CAP_WHY[k]}`}`);
  }
  say('');
}

/** One thread, or null with the refusal recorded. Registered for teardown when it lands. */
async function openThread(ctx, api, payload) {
  const res = await api.createThread(ctx.channel.id, payload);
  if (!res.ok) {
    say(`NOTE: create_thread "${payload.title}" refused: HTTP ${res.status} ${res.text.slice(0, 300)}`);
    return null;
  }
  const thread = res.json.task;
  ctx.cleanup.push({ what: `thread ${thread.id}`, run: () => api.closeThread(ctx.channel.id, thread.id) });
  return thread;
}

/** The live participant set, or null when the server sends no such field (unknown, not empty). */
async function participantsOf(api, ctx, thread) {
  const res = await api.thread(ctx.channel.id, thread.id);
  const set = res.json && res.json.task && res.json.task.participants;
  return Array.isArray(set) ? set : null;
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
        say(`         desktop-read ${who.padEnd(4)} ${readOf(d, ctx.name)}`);
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
    say('cleanup ok — harness channel and threads removed');
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    say(`HARNESS ERROR: ${err && err.message}`);
    if (err && err.stack) say(String(err.stack).split('\n').slice(1, 5).join('\n'));
    process.exit(2);
  });
