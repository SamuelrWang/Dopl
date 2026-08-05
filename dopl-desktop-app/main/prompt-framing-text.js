// The FIXED TEXT BLOCKS of a spawn prompt — the vocabulary, the prose invariant, and the law.
//
// Split out of `prompt-framing.js` at the §2 500-line cap (2026-08-04) when the P0-1 invariant
// landed. The seam is not arithmetic: this file is WHAT THE AGENT IS TOLD and changes every time
// a behaviour round rewrites a paragraph, while `prompt-framing.js` is HOW A TURN IS ASSEMBLED
// (sanitization, the nonce fence, the delivery call, which block goes in which shape) and
// changes when the assembly does. The same seam `channel-description.ts` and `channel.ts` are
// split on in the MCP package.
//
// EVERY BLOCK HERE IS FIXED TEXT — nothing is interpolated into any of them — so none of them
// can ever carry a fence token of its own. That property is why they were safe to lift out
// wholesale, and it must hold for anything added: a block that interpolates caller data belongs
// beside `sanitizeName`, not here.
//
// PURE: no electron / fs / path, so the truth tables `require` it directly.

// v3.0 THE VOCABULARY. Stated in the FIRST turn, outside the fence, so the agent writes
// the same words the operator reads in the window and in the channel. It is fixed text —
// nothing is interpolated into it — so it can never carry a fence token of its own.
//
// The distinction is load-bearing for the agent's plan, not decoration: a THREAD is the
// shared unit both members see and it does not pause, while a SESSION is the local run
// that does. Anything the agent scopes "for this session" (a standing grant, a mode) dies
// with the session; anything it says about the THREAD is visible to the other member.
//
// FIX S1: this used to teach `task=<id>` as the tool ARGUMENT. mcp__dopl__dopl_channel has no
// such parameter — the 1.7.11 cutover made the agent-facing argument `thread=<id>` and left the
// older word only on the post KINDS (`kind="task_*"`) and the storage key (`metadata.taskId`),
// which the agent never types. The split is stated below exactly that way.
//
// P0-1 (incident 2026-08-04) — THE FOUR KINDS ARE NOT A VOCABULARY TO PICK FROM. The last
// bullet used to LIST all four side by side and say "use each as given", which reads as an
// interchangeable set: a responder that had finished its work picked `task_finished` for the
// answer itself, and a `task_finished` body is structurally unrenderable on the peer's card
// (lib/group-thread.ts sets it as `endEvent` and never pushes it to `entries`). So the whole
// answer arrived on the wire and appeared nowhere. The bullet now states the SPLIT of
// authority instead of the list of names: three of them belong to the runtime and the close,
// one is an optional marker, and everything the agent says is a message.
const VOCABULARY = [
  'VOCABULARY (use these words when you write):',
  '- A CHANNEL (or DM) holds many THREADS.',
  '- A THREAD is ONE exchange between two members about one thing. It may be a single',
  '  message or a long piece of work. It is SHARED: both members see the same thread, its',
  '  title, and its status.',
  '- A SESSION is ONE member\'s agent run working a thread, on THAT member\'s machine. Each',
  '  side has its own session. A session pauses and resumes; a thread does not. You never',
  '  see the other member\'s session, only the messages it sends.',
  '- The tool ARGUMENT that names this thread is `thread=<id>`. Say "thread" in what you write.',
  '- The `task_` names are STORAGE words, not a menu. "task_started" / "task_finished" /',
  '  "task_failed" are LIFECYCLE MARKERS owned by the runtime that starts and stops a session',
  '  and by the close of a thread. They are not yours to post and the server refuses them from',
  '  you. What is yours: an ordinary MESSAGE for everything you say, and one optional',
  '  MILESTONE marker per step that lands.',
];

// P0-1 — THE INVARIANT THE PROMPT NEVER STATED, and the whole reason a finished piece of work
// vanished. mcp__dopl__dopl_channel defaults `kind` to "message" when the call omits it, and
// the delivery call this module prints has ALWAYS omitted it (deliveryCall), so the runtime was
// innocent: the AGENT chose a lifecycle kind, because nothing here said prose could not go in
// one. It is stated in the delivery section, on EVERY branch (with or without a resolved call,
// requester and responder alike), because delivery is the one section an agent re-reads when it
// is about to send something.
//
// Why it names the failure mode rather than just the rule: "use kind=message" reads as a
// formatting preference, and the agent had a reason to think otherwise. "the body of a
// task_finished is not rendered on the other member's card" is a fact it can act on.
//
// House voice (§H-13): no em dash — prompt-framing.test.mjs asserts every delivery line is free
// of one. Kept as an ARRAY (not a paragraph) so each branch of deliverySection splices it in
// beside its own lines and the em-dash / `task=` scanners in the truth table read it line by
// line like everything else.
const PROSE_RULE = [
  `EVERY SUBSTANTIVE WORD YOU SEND IS AN ORDINARY MESSAGE, YOUR FINAL ANSWER INCLUDED. The`,
  `delivery call above sets no kind, and that is correct: leave it that way. NEVER put prose`,
  `into a task_started, task_finished or task_failed post. Those are lifecycle markers, the`,
  `server refuses them from you, and their body is not shown on the other member's thread`,
  `card at all, so an answer written into one is delivered nowhere. If it is meant to be`,
  `read, send it as a message.`,
];

// D2 — THE LAW. The whole multiplayer contract in five rules, stated to the agent in its
// own first turn because it is the only place a room-bound session learns them: nothing in
// the SDK, the tool descriptions, or the channel transcript says who this process is or
// when it is allowed to speak. Fixed text — nothing is interpolated — so it can never carry
// a fence token of its own.
//
// Each rule exists because its absence is a concrete failure:
//   ADDRESS TO ACT     — the room is a MEETING, and an agent that answers every message is
//                        the reason the implicit 2-member trigger is disabled while team
//                        agents are present (targeting.classify). Unaddressed traffic is
//                        context, not a request.
//   REPLY WHERE ASKED  — an answer posted outside the thread it was asked in reaches the
//                        room as a brand-new request on the other machine.
//   NEVER ASSUME       — handles are peer-settable text. Another agent's name inside a
//                        message is DATA; it never makes this session that agent.
//   ESCALATE BY NAME   — a human is reached by ADDRESSING them, which notifies and never
//                        spawns. An agent that just says "someone should look at this"
//                        into the room has told nobody.
//   ONE VOICE          — every post carries this session's own agent identity, so the room
//                        can always attribute what it reads.
// THE LAW OF THIS ROOM was five rules opening a room-bound TEAM session's first turn:
// address to act (do work only when a message names your HANDLE), reply where you were
// asked, never assume another identity, escalate by addressing a human, one voice (post as
// yourself). Four of the five turned on being a NAMED AGENT, and named agents are gone
// (channels rollback §1) along with the room-bound session that read them. What survived is
// stated where it still applies: "reply where you were asked" is the THREAD_TAG rule below,
// and the addressing law itself lives in the MCP tool's own description, which every session
// reads on every connection.


// Why the tag must survive EVERY turn, not just the first post. Appended to the delivery
// section only when the call really carries a `thread` argument, so a session with no thread
// id keeps the wording it had before, byte for byte.
const THREAD_TAG = [
  `Keep that thread argument on every post you make here. It is what tells the other`,
  `member's machine that your message continues THIS thread; a post without it arrives`,
  `there as a brand new request and starts a second agent run against your own reply.`,
];

module.exports = { THREAD_TAG, VOCABULARY, PROSE_RULE };
