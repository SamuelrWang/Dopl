'use strict';

// LIVE CONTRACT HARNESS — THE MAIN-ROOM CHECKS (1-5 and 9).
//
// See checks-shared.js for the §2 split note, and checks.js for the ordered list these are
// registered in. Every rule about what a check may claim — PASS / FAIL / SKIP, and the ban on
// a vacuous pass — lives in the checks.js header and applies here unchanged.

const { decide, bothMachines } = require('./desktop');
const {
  FAIL, SKIP, wireOf, readOf, short, result, verdict, same, sorted, missing, base,
} = require('./checks-shared');

/**
 * 1. `intent:"chat"` with no mentions decides NOTHING, on both machines — AND THE CONTROL
 *    THAT MAKES THAT MEAN SOMETHING.
 *
 * THE BUG: the server stamped `metadata.intent` and nothing on the desktop ever read it,
 * so a human aside was an inbound turn for every engaged agent in the room.
 *
 * WHY THIS CHECK HAS FOUR STEPS. "Nothing happened" is the cheapest assertion in software
 * and the easiest one to pass for the wrong reason: in a room where no agent is ENGAGED,
 * an unaddressed message decides nothing whether or not the chat brake exists, so the
 * obvious version of this check proves precisely nothing. So:
 *
 *   1 ENGAGE  a human-authored post naming @hxa was made in setup — the same shape check 2
 *             asserts on — and the roster was RE-READ. `engagedAt` on that row is the
 *             server's word that the lane exists; nothing is assumed (`ctx.engagedRow`).
 *   2 CHAT    the unaddressed `intent:"chat"` post is evaluated on both machines.
 *   3 CLAIM   nothing is decided, and specifically THE ENGAGED AGENT IS NOT FED.
 *   4 CONTROL the SAME post without `intent` must FEED that engaged agent. If it does not,
 *             the engaged lane never armed, step 3 is vacuous again, and this check FAILS
 *             saying so rather than reporting a pass it did not earn.
 *
 * The CONTROL is a real post, not a mutated copy: `intent` is simply omitted, which is also
 * the shape every older client and the whole MCP surface writes — so it pins the documented
 * "an ABSENT intent reads as a REQUEST" default at the same time.
 *
 * The pass condition is the DIFFERENCE: control feeds, chat does not. Neither half alone
 * is evidence about `intent`.
 *
 * WHEN STEP 1 IS IMPOSSIBLE this SKIPs on `engagement_stamped`, whose reason names the
 * exact server line that refused (engagement needs a HUMAN credential; this harness holds a
 * device token). Both posts are still evaluated and both verdicts are printed either way —
 * a SKIP here reports the behavior, it just refuses to call it proof.
 *
 * BUT IT DOES NOT SKIP EVERYTHING, and this is the half worth having on a wire that can
 * never engage. `engagement.mayEngage` IS the chat brake — `humanAuthored && !isChat` — and
 * it is computed by the shipped module off the server's own stamped `intent` on these two
 * real messages. If it does not MOVE between them, the desktop is not reading `intent` at
 * all, which is the original bug, and that is provable with nobody engaged. So the
 * PREDICATE DIFFERENTIAL is asserted BEFORE the engagement gate and FAILS there. What the
 * SKIP withholds is only the last link: that the predicate gates the engaged lane's
 * DELIVERY.
 */
async function checkChatNoMentions(ctx) {
  const m = ctx.msg.chat;
  const control = ctx.msg.control;
  const both = await bothMachines(ctx.dsk, base(ctx, m));
  const ctl = await bothMachines(ctx.dsk, base(ctx, control));
  const row = ctx.engagedRow;
  const observed = [
    `step 1 ENGAGE  addressed @${ctx.engageTarget.name} as a human-authored post, then re-read the roster: ` +
      (row
        ? `engagedAt=${row.engagedAt} engagedBy=${short(row.engagedBy)} — the engaged lane EXISTS`
        : 'NO row of mine came back engaged — the engaged lane does not exist on this wire'),
    `step 2 CHAT    (intent=chat, unaddressed) owner ${readOf(both.mine, ctx.name)}`,
    `step 2 CHAT    (intent=chat, unaddressed) peer  ${readOf(both.peer, ctx.name)}`,
    `step 4 CONTROL (no intent,   unaddressed) owner ${readOf(ctl.mine, ctx.name)}`,
    `step 4 CONTROL (no intent,   unaddressed) peer  ${readOf(ctl.peer, ctx.name)}`,
  ];
  if (!ctx.caps.intent) return { ...missing(ctx, 'intent'), extraLines: observed };
  if (!ctx.caps.engagement) return { ...missing(ctx, 'engagement'), extraLines: observed };

  const fails = [];
  // ── the two posts really are the same post but for one field ────────────────────
  if (m.metadata.intent !== 'chat') fails.push(`server did not stamp intent=chat (got ${JSON.stringify(m.metadata.intent)})`);
  if (control.metadata.intent !== undefined) {
    fails.push(`the control carries intent=${JSON.stringify(control.metadata.intent)} — it is not a control`);
  }
  for (const [label, msg] of [['chat', m], ['control', control]]) {
    if (msg.authorKind !== 'user' || msg.authorUserId !== ctx.me) {
      fails.push(`${label}: authorKind=${msg.authorKind} author=${short(msg.authorUserId)} — not a human post of mine`);
    }
    if (msg.metadata.to_agent_ids || msg.metadata.to_agent_id) fails.push(`${label}: the server addressed an unaddressed post`);
  }

  // ── THE PREDICATE DIFFERENTIAL, provable with nobody engaged ────────────────────
  // The shipped brake, read off two real messages that differ only in `intent`. A desktop
  // that ignores `intent` answers the same for both, and that is the shipped bug.
  for (const [who, d] of Object.entries(both)) {
    if (!d.isChat) fails.push(`${who}: engagement.isChat read false off a chat post`);
    if (d.mayEngage) fails.push(`${who}: engagement.mayEngage read TRUE off a chat post`);
  }
  for (const [who, d] of Object.entries(ctl)) {
    if (d.isChat) fails.push(`${who}: control: engagement.isChat read TRUE off a post with no intent`);
    if (!d.mayEngage) fails.push(`${who}: control: engagement.mayEngage read false off an untagged human post`);
  }
  observed.push(
    `predicate differential (needs no engagement): mayEngage chat=${both.mine.mayEngage} control=${ctl.mine.mayEngage}` +
      ` — the brake itself moves with the server's stamped intent`
  );
  if (fails.length) return verdict(fails, { wire: wireOf(m), both, extraLines: observed });

  // ── the DELIVERY half needs a state this wire may refuse to create ──────────────
  if (!ctx.caps.engagement_stamped) {
    return {
      ...missing(ctx, 'engagement_stamped'),
      extraLines: observed.concat([
        'so: the brake PREDICATE is proven above on real server-stamped intent; what is NOT proven is that it ' +
          "gates the engaged lane's DELIVERY, because no agent could be engaged here at all.",
      ]),
    };
  }

  // ── step 1, asserted rather than assumed ────────────────────────────────────────
  if (!row || row.ownerUserId !== ctx.me) fails.push('the engaged row is not an agent of mine');

  // ── step 4, THE CONTROL: without this the rest is unfalsifiable ─────────────────
  if (!ctl.mine.fed.includes(ctx.engageTarget.id)) {
    fails.push(
      `THE ENGAGED LANE NEVER ARMED: the control (identical but for intent) fed ` +
        `[${ctl.mine.fed.map(ctx.name).join(',') || 'nobody'}] on the owner machine, so "the chat post fed nobody" ` +
        `proves nothing about intent`
    );
  }

  // ── step 3, THE CLAIM (the predicates themselves were asserted above) ───────────
  if (both.mine.fed.includes(ctx.engageTarget.id)) {
    fails.push(`the ENGAGED agent ${ctx.engageTarget.name} was fed a chat post — the brake did not hold`);
  }
  for (const [who, d] of Object.entries(both)) {
    if (d.routed !== '') fails.push(`${who}: routed ${d.routed}, expected ''`);
    if (d.fed.length) fails.push(`${who}: fed ${d.fed.length} agent(s), expected none`);
    if (d.classify === 'trigger') fails.push(`${who}: classify said trigger`);
  }
  return verdict(fails, { wire: wireOf(m), both, extraLines: observed });
}

/**
 * 2. A message that NAMES an agent routes to exactly that agent, on the owner's machine only.
 *
 * THE BUG: the composer inserted `@handle` as plain text and never produced `toAgents`, so a
 * message that LOOKED addressed carried no address at all. The assertion is on the STAMPED
 * metadata, which is the only place the address is real — the body text is decoration.
 */
async function checkMentionRoutesToOwnerOnly(ctx) {
  const m = ctx.msg.one;
  const both = await bothMachines(ctx.dsk, base(ctx, m));
  const fails = [];
  if (!both.mine.addressed.length) {
    fails.push('the server stamped NO agent address for a post whose body carries an @handle');
  } else if (!same(both.mine.addressed, [ctx.agents.a.id])) {
    fails.push(`desktop read address [${both.mine.addressed.map(ctx.name).join(',')}], expected [${ctx.agents.a.name}]`);
  }
  if (both.mine.routed !== 'fed') fails.push(`owner: routed ${both.mine.routed || "''"}, expected fed`);
  if (!same(both.mine.fed, [ctx.agents.a.id])) {
    fails.push(`owner: fed [${both.mine.fed.map(ctx.name).join(',')}], expected [${ctx.agents.a.name}]`);
  }
  if (both.peer.routed !== '') fails.push(`peer: routed ${both.peer.routed}, expected '' (not the peer's agent)`);
  if (both.peer.fed.length) fails.push(`peer: fed ${both.peer.fed.length} agent(s) it does not own`);
  if (both.peer.classify === 'trigger') fails.push("peer: classify said trigger for a message naming somebody else's agent");
  const via = m.metadata.to_agent_ids ? 'to_agent_ids[] (new contract)' : 'to_agent_id scalar (compat mirror only)';
  return verdict(fails, { wire: wireOf(m), both, extraLines: [`addressing arrived as ${via}`] });
}

/**
 * 3. A message addressed to TWO agents reaches BOTH — and what the compat scalar alone
 *    would do on an older build.
 *
 * THE BUG: the server sends `to_agent_ids[]` while the installed desktop read only the
 * `to_agent_id` scalar, so the second addressee was silently dropped. The "older build" is
 * simulated HONESTLY — the same real message with the array key removed, run through the
 * same real modules — so it measures the loss instead of asserting a belief about it.
 */
async function checkMultiAddress(ctx) {
  const m = ctx.msg.two;
  const compat = [];
  // The COMPAT DIRECTION is testable on any server: a single-address post arrives as the
  // scalar alone here, and the desktop must still resolve it. That half runs regardless.
  const single = await decide(ctx.dsk, { ...base(ctx, ctx.msg.one), myUserId: ctx.me });
  compat.push(
    `compat direction (scalar-only wire -> new desktop): addressed=[${single.addressed.map(ctx.name).join(',')}] fed=[${single.fed.map(ctx.name).join(',')}]`
  );
  if (!ctx.caps.to_agent_ids) return { ...missing(ctx, 'to_agent_ids'), extraLines: compat };

  const both = await bothMachines(ctx.dsk, base(ctx, m));
  const legacyMsg = JSON.parse(JSON.stringify(m));
  delete legacyMsg.metadata.to_agent_ids;
  const legacy = await decide(ctx.dsk, { ...base(ctx, legacyMsg), myUserId: ctx.me });

  const want = sorted([ctx.agents.a.id, ctx.agents.b.id]);
  const fails = [];
  if (!same(sorted(m.metadata.to_agent_ids), want)) {
    fails.push(`server addressing wrong: to_agent_ids=${JSON.stringify(m.metadata.to_agent_ids)}`);
  }
  if (typeof m.metadata.to_agent_id !== 'string') {
    fails.push('server dropped the compat scalar to_agent_id — an older desktop would see NO address at all');
  }
  if (!same(sorted(both.mine.fed), want)) {
    fails.push(`owner: fed [${both.mine.fed.map(ctx.name).join(',')}], expected BOTH [${want.map(ctx.name).join(',')}]`);
  }
  if (both.peer.fed.length) fails.push(`peer: fed ${both.peer.fed.length} agent(s) it does not own`);

  const lost = want.filter((id) => !legacy.fed.includes(id));
  compat.push(
    `scalar-only replay (older desktop, same real message): fed [${legacy.fed.map(ctx.name).join(',')}] — loses [${lost.map(ctx.name).join(',') || 'nothing'}]`
  );
  return verdict(fails, { wire: wireOf(m), both, extraLines: compat });
}

/**
 * 4. The operator's OWN message addressed to their OWN agent routes.
 *
 * THE BUG, and the product's primary flow: the operator's own messages were excluded from
 * every path that could reach their own agent, so "/new-agent" then "@quartz do X" reached
 * nobody. The second assertion is the gate bypass — a person's own typed sentence must feed
 * straight through rather than raising a card asking them to approve themselves.
 */
async function checkOwnMessageToOwnAgent(ctx) {
  const m = ctx.msg.one;
  const mine = await decide(ctx.dsk, { ...base(ctx, m), myUserId: ctx.me });
  const fails = [];
  if (m.authorUserId !== ctx.me) fails.push("precondition lost: this message is not the operator's own");
  if (m.authorKind !== 'user') fails.push(`precondition lost: the server stored authorKind=${m.authorKind}, so this is not a TYPED message`);
  if (mine.routed !== 'fed') fails.push(`routed ${mine.routed || "''"}, expected fed — the operator's own message reached nobody`);
  if (!mine.woke.includes(ctx.agents.a.id)) fails.push('the named agent was never woken');
  if (!mine.selfAuthoredFeeds.includes(ctx.agents.a.id)) {
    fails.push('fed WITHOUT selfAuthored — the operator would be asked to approve their own sentence');
  }
  return verdict(fails, { wire: wireOf(m), both: { mine } });
}

/**
 * 5. An AGENT-authored, unaddressed message engages nobody and triggers nobody, on both
 *    machines. THE LOOP BRAKE, against real wire data — WITH THE SAME CONTROL CHECK 1 USES.
 *
 * "Triggers nobody" has the identical vacuity trap as check 1: an unaddressed post in a room
 * that could not have triggered anyone anyway proves nothing about `authorKind`. So the
 * CONTROL is asserted first — the same unaddressed post from a HUMAN — and the peer machine
 * must answer 'trigger' for it. That is classify's implicit 1:1 rule, and it is the exact
 * branch the agent brake (`if (m.authorKind === 'agent') return 'fyi'`) sits one line above.
 * Control triggers, twin does not: that difference is the brake. If the control does NOT
 * trigger, the room could not have triggered for anybody and this check says so.
 *
 * WHY THE PEER MACHINE IS WHERE IT BITES: on the OWNER's machine classify returns 'ignore' at
 * its own-author guard before authorship is ever consulted, so the owner side of this claim
 * is unfalsifiable by construction and is asserted only as "nothing happened".
 *
 * THE ENGAGED HALF ("engages nobody") is only armed when an agent could be engaged at all —
 * see check 1's `engagement_stamped`. When it is, the engaged agent must not be fed either,
 * and that is asserted here too rather than being left to the day somebody notices.
 */
async function checkAgentAuthoredUnaddressed(ctx) {
  const m = ctx.msg.agentNoise;
  const both = await bothMachines(ctx.dsk, base(ctx, m));
  const ctl = await bothMachines(ctx.dsk, base(ctx, ctx.msg.control));
  const armed = ctl.peer.classify === 'trigger';
  const lines = [
    `control (same shape, HUMAN author) peer classify=${ctl.peer.classify} — the trigger lane is ${armed ? 'ARMED' : 'NOT ARMED'}`,
    `agent-authored twin                peer classify=${both.peer.classify} (memberCount=${ctx.channel.memberCount}, peer teamAgents=${both.peer.teamAgents})`,
  ];
  if (!armed) {
    // TWO DIFFERENT THINGS, AND THEY GET DIFFERENT VERDICTS. A room with no second member
    // cannot arm classify's implicit 1:1 rule at all — an environment fact, named and
    // SKIPPED. A two-member room that still will not trigger for a human's unaddressed post
    // is a desktop regression in its own right, and swallowing it as a skip would hide the
    // very failure this lane exists to surface.
    const noPeer = !!ctx.threadSkip;
    const why =
      `the peer machine answers "${ctl.peer.classify}" for the HUMAN control too, so nothing here could have ` +
      `triggered and the brake's refusal is unprovable`;
    return noPeer
      ? result(SKIP, `${why} — ${ctx.threadSkip}`, { extraLines: lines })
      : result(
          FAIL,
          `${why} — and with memberCount ${ctx.channel.memberCount} and no team agent of the peer's, classify ` +
            `SHOULD have said trigger for it`,
          { wire: wireOf(ctx.msg.control), both: ctl, extraLines: lines }
        );
  }

  const fails = [];
  if (m.authorKind !== 'agent') fails.push(`server stored authorKind=${m.authorKind}, expected agent`);
  if (typeof m.metadata.author_agent_id !== 'string') fails.push('server did not stamp author_agent_id');
  if (m.metadata.to_agent_ids || m.metadata.to_agent_id) fails.push('server addressed an unaddressed post');
  for (const [who, d] of Object.entries(both)) {
    if (d.routed !== '') fails.push(`${who}: routed ${d.routed}`);
    if (d.fed.length) fails.push(`${who}: fed ${d.fed.length} agent(s) off an agent-authored post`);
    if (d.classify === 'trigger') fails.push(`${who}: classify said trigger for an agent-authored unaddressed post`);
    if (d.humanAuthored) fails.push(`${who}: engagement.humanAuthored read TRUE off an agent post`);
  }
  if (ctx.caps.engagement_stamped) {
    if (both.mine.fed.includes(ctx.engageTarget.id)) {
      fails.push(`the ENGAGED agent ${ctx.engageTarget.name} took an agent-authored post — the loop brake did not hold`);
    }
    lines.push(`engaged-lane half armed: @${ctx.engageTarget.name} is engaged and was NOT fed`);
  } else {
    lines.push(
      'engaged-lane half NOT armed (see check 1): with nothing engaged, "engages nobody" would read the same ' +
        'whether or not the brake exists. What is proven here is the classify brake, against the control above.'
    );
  }
  return verdict(fails, { wire: wireOf(m), both, extraLines: lines });
}

/**
 * 9. A MILESTONE THAT NAMES AN AGENT IS DELIVERED — `kind="task_progress"` (F1).
 *
 * THE BUG, and it is the most expensive one this lane has ever been pointed at: every desktop
 * delivery lane opened with `if (m.kind !== 'message') return ''`, in FRONT of the addressed
 * lane, the thread lane and the engaged lane — while the MCP tool description and this app's
 * own spawn prompt both instruct agents to log progress as `kind="task_progress"`. Across seq
 * 340-368 of the 2026-08-01 two-agent run, every undelivered post was a task_* and every
 * delivered one was a 'message', with no counterexample in either direction. Nine posts queued
 * for the other agent — three of them carrying `metadata.to_agent_ids` — started nothing.
 *
 * WHY IT IS EVALUATED AS THE PEER, AND WHAT IS SIMULATED. A milestone reaching a peer's agent
 * is a CROSS-ACCOUNT claim: the author and the addressed agent's owner must differ, or the
 * main-room self brake (`myOwnAgentSpoke`) correctly refuses it. This harness holds ONE
 * credential, so both agents are the caller's — the message is entirely real (the server
 * stamped the kind, the addressing and the owner bridge), and the ONE field re-written is the
 * ROSTER'S `ownerUserId`, which is what makes the evaluation "the peer's machine" rather than
 * a second one of mine. That is the same honest-simulation discipline check 3 uses when it
 * drops `to_agent_ids` to replay an older desktop, and it is stated here rather than hidden.
 *
 * THREE ASSERTIONS, and the second is what keeps the first from being vacuous:
 *   DELIVERED  the addressed milestone is `fed` on the machine that owns the named agent.
 *   CONTROL    the UNADDRESSED twin — same kind, same author, same room — routes NOBODY. So
 *              the delivery above came from the ADDRESSING, not from "task_* now wakes people".
 *   SELF BRAKE on the OWNER's machine the same real post routes nothing: an agent's own
 *              account's milestone does not drive its siblings in the open room.
 * Plus the gate: a milestone is never flagged `selfAuthored`, so it is never gate-bypassed.
 */
async function checkMilestoneKindDelivers(ctx) {
  const m = ctx.msg.milestone;
  const loose = ctx.msg.milestoneLoose;
  if (!m || !loose) {
    return result(SKIP, `the harness could not post a task_progress: ${ctx.milestoneError || 'unknown'}`);
  }
  // The live rows, re-owned — see the docblock. Everything else is the server's own bytes.
  const peerRoster = ctx.roster.map((r) => ({ ...r, ownerUserId: ctx.peer }));
  const onPeer = (post) => decide(ctx.dsk, { ...base(ctx, post), roster: peerRoster, myUserId: ctx.peer });
  const peer = await onPeer(m);
  const control = await onPeer(loose);
  const owner = await decide(ctx.dsk, { ...base(ctx, m), myUserId: ctx.me });
  const lines = [
    `addressed milestone  peer-machine (roster re-owned to ${short(ctx.peer)}) ${readOf(peer, ctx.name)}`,
    `CONTROL unaddressed  peer-machine ${readOf(control, ctx.name)}`,
    `same post, OWNER machine ${readOf(owner, ctx.name)}`,
  ];
  if (m.kind !== 'task_progress' || loose.kind !== 'task_progress') {
    return result(FAIL, `the server stored kind=${m.kind}/${loose.kind}, not task_progress — this check tests nothing`, {
      wire: wireOf(m),
      extraLines: lines,
    });
  }
  if (!peer.addressed.length) return { ...missing(ctx, 'to_agent_ids'), extraLines: lines };

  const fails = [];
  if (!peer.addressed.includes(ctx.agents.b.id)) {
    fails.push(`the desktop read address [${peer.addressed.map(ctx.name).join(',')}], expected [${ctx.agents.b.name}]`);
  }
  if (loose.metadata.to_agent_ids || loose.metadata.to_agent_id) {
    fails.push('the control carries an agent address — it is not a control');
  }
  if (peer.routed !== 'fed') {
    fails.push(
      `THE F1 REGRESSION: an ADDRESSED kind="task_progress" routed ${peer.routed || "''"} on the machine that owns ` +
        `@${ctx.agents.b.name}. Every in-thread agent update is undeliverable again`
    );
  }
  if (!peer.fed.includes(ctx.agents.b.id)) fails.push(`the named agent was not fed (fed=[${peer.fed.map(ctx.name).join(',')}])`);
  if (peer.selfAuthoredFeeds.length) fails.push('a milestone was flagged selfAuthored — it would bypass the inbound gate');
  if (control.routed !== '' || control.fed.length) {
    fails.push(
      `the UNADDRESSED control routed ${control.routed || "''"} fed [${control.fed.map(ctx.name).join(',')}] — ` +
        `milestone chatter must wake nobody, and without that the delivery above proves nothing`
    );
  }
  if (owner.routed !== '' || owner.fed.length) {
    fails.push(`owner machine: routed ${owner.routed} fed ${owner.fed.length} — the main-room self brake did not hold`);
  }
  return verdict(fails, { wire: wireOf(m), both: { peer, mine: owner }, extraLines: lines });
}

module.exports = {
  checkChatNoMentions,
  checkMentionRoutesToOwnerOnly,
  checkMultiAddress,
  checkOwnMessageToOwnAgent,
  checkAgentAuthoredUnaddressed,
  checkMilestoneKindDelivers,
};
