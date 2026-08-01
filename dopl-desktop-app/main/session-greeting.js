// session-greeting.js — THE ARRIVAL. A summon is a MESSAGE IN THE CHAT, never a window.
//
// WHAT THIS REPLACES. `/new-agent` used to open an Electron window and emit its "I am in the
// room" line INTO that window (session-team.summon -> deps.emit). The channel saw nothing, so
// the one surface everybody shares — the chat — had no evidence an agent had arrived, and the
// operator got a window they never asked for, seeded with the whole channel. The chat IS the
// interface: a summon posts, as the agent, into the room it was summoned into, and no window
// opens at all. A window is what an operator gets when they deliberately open the session
// (session-reopen / the tray), and nothing else.
//
// THE GREETING IS A CONSTANT, AND THAT IS A DELIBERATE REVERSAL (2026-07-31, operator).
// The first cut of this module ran ONE bounded headless turn per summon: it read the last 15
// messages of the room, fenced them into a prompt, and let the model write an arrival line
// that named what it thought the room was working on. The operator's words on seeing it: "we
// shouldn't have it look through the entire thing first. We don't need to do a first turn.
// Let's just say, hi. How can I help you?"
//
// So the whole apparatus is gone — the prompt builder, the room read, the spawn, the answer
// cleaner, and the fallback-vs-LLM split that only existed because a turn can fail. What is
// left is a string. That is not a downgrade dressed up as a simplification; it is strictly
// better on every axis the removed code was bounded on:
//   COST      zero. No spawn, no tokens, no budget flag to police.
//   LATENCY   one POST. An arrival that had to wait up to 60s for a turn is not an arrival.
//   BLAST     nothing untrusted is read, so nothing untrusted can be prompt-injected. The
//             fence, the fixed-point delimiter stripper and the read_only profile were all
//             defences for a read this summon no longer performs.
//   FAILURE   there is one failure mode left (the POST), and it is retryable.
// Everything the same fix established about the SHAPE of a summon is untouched: no window, no
// session, posted into the channel AS the agent, self-addressed in a DM so the loop brake
// reads it as noise, status flipped to `active` only on a confirmed post, and an idempotency
// key that dedupes a retry.
//
// A SUMMON NEVER ENDS IN SILENCE. The only thing that can leave the room quiet is the POST
// failing, and that leaves the row `summoned` so the next reconcile pass retries; the
// clientMsgId is deterministic per (channel, agent, row-stamp), so a retry after a post that
// landed but whose response was lost dedupes server-side instead of double-greeting.
//
// THE GREETING IS UNADDRESSED, and that is the loop brake (targeting.classify): an
// agent-authored message with no `to_user_id` classifies 'fyi' on every other machine and
// 'ignore' on this one, so it can trigger nobody. ONE channel shape defeats that from the
// server side and is handled explicitly — see directAddressee().

const channelPost = require('./channel-post'); // the ONE writer to /messages on this side
const framing = require('./prompt-framing'); // sanitizeName: the shared name neutralizer
const { diag } = require('./diag');

// ─── BEGIN SESSION-GREETING-PURE (injectable; unit-tested via source extraction) ───
// Every dependency is one of the module-top requires referenced as a FREE VARIABLE —
// channelPost, framing, diag — so the truth table drives the REAL greeting policy with a
// fake for the one HTTP write.

// THE GREETING, in full. It says the two things that are true without reading anything and
// nothing else: the agent is here, and it is reached by THIS handle. The handle is the whole
// informational payload — an operator who has just summoned an agent has to learn what to
// type to address it, and the arrival message is the only place the room is ever told.
// No em dash (product copy rule), no promise about what it can do, no question it cannot
// answer, and the name is run through the SHARED sanitizer because a handle is
// caller-controlled text like any other.
function cannedGreeting(handle) {
  const name = framing.sanitizeName(handle);
  // An unnamed row still greets rather than staying silent, but it cannot teach a handle it
  // does not have, so it says the honest thing in a grammatical sentence of its own.
  return name ? '@' + name + ' here. How can I help?' : 'This agent is here. How can I help?';
}

// THE ONE CHANNEL SHAPE WHERE "UNADDRESSED" IS NOT UP TO US.
//
// In a DIRECT channel the server addresses every post for you: resolvePostMetadata stamps
// `to_user_id` from the resolved direct peer whenever the caller named nobody
// (service-writes-metadata.ts). So a greeting posted unaddressed into a DM arrives on the
// peer's machine as an agent-authored message addressed to THEM — and targeting.classify
// returns 'trigger' for that (the escalation branch is disabled in a direct channel by FIX
// S1, and the two task-reply branches need a thread tag a greeting has none of). That is the
// 2026-07-31 untagged-reply incident exactly: a consent card and a counter-session raised
// against an arrival announcement.
//
// The desktop cannot ask the server not to stamp, but it CAN name an addressee the server
// will not override, and the honest one is the operator who summoned the agent: this is
// their agent announcing itself in their own DM. classify then reads
// `toUserId === m.authorUserId` — the author IS the operator, because an agent id supplements
// an author and never replaces one — and returns 'ignore' as self-addressed noise, on the
// peer's machine and on this one. Nothing is triggered, nothing is spawned.
//
// Group channels stamp nothing of their own, so they stay genuinely unaddressed ('' here) and
// take the plain 'fyi' path. The flag must say DIRECT exactly; an absent or unparseable DTO
// field degrades to the group shape, which is the shape the brake already covers.
function directAddressee(a) {
  return a && a.direct === true && a.ownerUserId ? String(a.ownerUserId) : '';
}

// The idempotency key. Deterministic per (channel, agent, ROW STAMP): a retry after an
// unconfirmed post dedupes server-side, while a row that was dismissed and summoned again
// carries a new `updatedAt` and therefore greets again instead of being deduped into silence.
function greetingMsgId(a) {
  const stamp = String((a && a.agentStamp) || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 20);
  return `agent-greeting-${a.channelId}-${a.agentId}${stamp ? '-' + stamp : ''}`;
}

// SUMMON, THE WHOLE OF IT: post the canned line as the agent. One HTTP write, no spawn, no
// window, no read of anything. Returns { greeted: true } on a confirmed post — the caller
// flips the row to `active` — or { skipped: 'post-failed' }, which leaves the row `summoned`
// for the next pass.
async function greet(a) {
  if (!a || !a.channelId || !a.agentId) return { skipped: 'disabled' };
  const posted = await channelPost.postAgentMessage(
    { channel: { id: a.channelId, name: a.channelName || null }, workspaceId: a.workspaceId },
    {
      text: cannedGreeting(a.agentName),
      agentId: a.agentId,
      clientMsgId: greetingMsgId(a),
      toUserId: directAddressee(a),
    }
  );
  if (!posted) {
    diag('greeting: NOT posted', String(a.agentName || a.agentId).slice(0, 24), '- row stays summoned');
    return { skipped: 'post-failed' };
  }
  diag('greeting: posted', String(a.agentName || a.agentId).slice(0, 24), 'in', String(a.channelId).slice(0, 8));
  return { greeted: true };
}

// ─── END SESSION-GREETING-PURE ─────────────────────────────────────────────────────

module.exports = {
  greet,
  cannedGreeting,
  directAddressee,
  greetingMsgId,
};
