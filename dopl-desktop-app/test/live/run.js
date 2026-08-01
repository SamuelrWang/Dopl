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
  // The addressed posts go FIRST so that both agents are ENGAGED server-side by the time the
  // chat post lands: without the chat brake, an engaged agent takes that post, so check 1
  // tests the brake rather than an empty room. Whether that engagement ACTUALLY LANDED is
  // not assumed — it is read back off the roster below and probed as a capability, because
  // an unengaged room makes check 1 vacuous and the harness has to know which run it is in.
  // (Against a server carrying the 2026-07-31 credential-keyed brake it never lands here at
  // all; see `engagement_stamped` in CAP_WHY. The order is still right for the day it does.)
  //
  // AND THE CONTROL. `chat` and `control` are the SAME post but for one field: `control`
  // omits `intent` entirely. Check 1 needs both, because "the chat post fed nobody" is only
  // evidence about `intent` if the otherwise-identical post DID feed somebody. The control
  // is also what arms check 5 — an unaddressed HUMAN post is the shape classify answers
  // 'trigger' for, so it proves the room can trigger at all before check 5 claims the loop
  // brake is what stopped the agent-authored twin.
  //
  // `authorKind: 'user'` IS LOAD-BEARING. The device token is an AGENT credential and the
  // service derives `agent` from it when the field is omitted — so every post would be
  // agent-authored, the loop brake would refuse everything, and checks 1/2/4 would pass
  // vacuously against a room where nothing could ever route. A human TYPING in the composer
  // posts over a cookie session as `user`, and that is the row shape being reproduced.
  //
  // WHAT IT DOES NOT BUY IS ENGAGEMENT, and that limit is the whole of check 1's SKIP.
  // `authorKind` is a CLAIM about the row; `ctx.source` is the authentication FACT, and
  // since 2026-07-31 the server engages on the fact (`recordAgentEngagement`). So these
  // posts route and wake exactly like a person's and engage nobody — which is the loop
  // brake working, not a bug, and is why the harness probes engagement instead of assuming
  // this shape produced it.
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
  posted.control = await must(api.post(ctx.channel.id, {
    body: 'live harness: human aside, addressed to nobody, NO intent — the control. Automated probe, no action needed.',
    authorKind: 'user',
    clientMsgId: `harness-${tg.stamp}-control`,
  }), 'post control');
  posted.agentNoise = await must(api.post(ctx.channel.id, {
    body: 'live harness: an agent talking to the room, addressed to nobody',
    authorKind: 'agent',
    authorAgentId: ctx.agents.a.id,
    clientMsgId: `harness-${tg.stamp}-noise`,
  }), 'post agent-noise');

  // ── THE MILESTONE PAIR (F1) — the kind the product's own prompts ask agents to post ──
  // `kind="task_progress"` is what `channel-description.ts` and `prompt-framing.js` tell every
  // spawned session to log its progress as, and until 2026-08-01 the desktop refused every one
  // of them before it read a single addressee. These two posts differ in ONE field, `toAgents`:
  // the addressed one is the shape that was silently undeliverable for a whole two-agent run,
  // and the unaddressed twin is check 9's CONTROL, because "the addressed milestone routed"
  // only means something if the unaddressed one did not.
  //
  // POSTED SOFT (no `must`): a server that refuses the kind or this shape SKIPs check 9 rather
  // than aborting the eight checks that have nothing to do with it.
  const milestone = async (key, body, extra) => {
    const res = await api.post(ctx.channel.id, {
      body,
      kind: 'task_progress',
      authorKind: 'agent',
      authorAgentId: ctx.agents.a.id,
      clientMsgId: `harness-${tg.stamp}-${key}`,
      ...extra,
    });
    if (res.ok) posted[key] = res.json.message;
    else ctx.milestoneError = `${key}: HTTP ${res.status} ${res.text.slice(0, 300)}`;
  };
  await milestone('milestone', `live harness: milestone for @${ctx.agents.b.name} — automated probe, no action needed.`, {
    toAgents: [ctx.agents.b.name],
  });
  await milestone('milestoneLoose', 'live harness: milestone addressed to nobody — the control.', {});

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

  // ── DID THE ENGAGEMENT ACTUALLY LAND? THE SERVER'S WORD, RE-READ ──────────────
  // The addressed posts above are the ENGAGE step: a human-authored post naming @hxa is
  // exactly what `recordAgentEngagement` stamps `engaged_at` for. It is CONFIRMED here off
  // the roster the desktop itself reads, never assumed — and when it did not land, check 1
  // says so and stops rather than "passing" against a room where the lane it tests is
  // unreachable. `engageTarget` is the agent check 1 drives; `engagedRow` is the server's
  // row for it, or null.
  ctx.engageTarget = ctx.agents.a;
  ctx.engagedRow = ctx.roster.find((r) => r.id === ctx.engageTarget.id && r.engagedAt) || null;

  // ── WHAT THIS WIRE COULD ACTUALLY DO, probed off the run just produced ───────
  // Not a version string and not a guess: each one asks "did the field the desktop reads
  // actually come back". The day the wave deploys, the gated checks arm themselves.
  //
  // `engagement_stamped` IS THE ODD ONE OUT AND IT IS LABELLED AS SUCH BELOW. Every other
  // entry is a deploy fact ("the server does not send this yet"). That one is a fact about
  // THIS CALLER: the server implements engagement and refuses to stamp it for an AGENT
  // credential, which is every credential this harness can hold. It is probed the same way
  // regardless — post, then re-read — so the day a run holds a human credential it arms.
  ctx.caps = {
    to_agent_ids: Array.isArray(ctx.msg.two.metadata.to_agent_ids),
    intent: ctx.msg.chat.metadata.intent === 'chat',
    engagement: ctx.roster.some((r) => Object.prototype.hasOwnProperty.call(r, 'engagedAt')),
    engagement_stamped: !!ctx.engagedRow,
    thread_participants: Array.isArray(ctx.roomParticipants),
    handshake_derivation: Array.isArray(ctx.derivedParticipants) && ctx.derivedParticipants.length > 0,
  };

  say(
    `wire — ${all.length} messages, roster ${ctx.roster.length} agents ` +
      `(${ctx.engagedRows.length} engaged), memberCount ${ctx.channel.memberCount}` +
      (ctx.room ? `, ${[ctx.derivedThread, ctx.slugThread, ctx.room].filter(Boolean).length} threads` : '')
  );
  say('');
  say('CAPABILITIES (probed live — a missing one SKIPS its checks, it does not fail them)');
  for (const [k, v] of Object.entries(ctx.caps)) {
    say(`  ${v ? 'yes' : 'NO '}  ${k}${v ? '' : `  — ${CAP_WHY[k]}`}`);
  }
  if (!ctx.caps.engagement_stamped) {
    say(
      `      evidence: posted a human-authored post addressing @${ctx.engageTarget.name} as ${ctx.me}, ` +
        `then re-read GET /api/channels/${ctx.channel.id}/agents — ` +
        ctx.roster.map((r) => `${r.name} engagedAt=${r.engagedAt === undefined ? '(no field)' : String(r.engagedAt)}`).join(', ')
    );
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
