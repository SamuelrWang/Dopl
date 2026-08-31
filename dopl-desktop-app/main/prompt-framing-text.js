// The FIXED TEXT BLOCKS of a spawn prompt — the vocabulary, the prose invariant, and the
// thread-tag rule (`module.exports = { THREAD_TAG, VOCABULARY, PROSE_RULE }`). It also held THE
// LAW, the five-rule multiplayer contract a room-bound TEAM session opened with; that block is
// deleted with the named agents four of its five rules turned on (channels rollback §1) and only
// its epitaph remains, above THREAD_TAG.
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
// authority instead of the list of names: three of them belong to the runtime, one is an
// optional marker, and everything the agent says is a message. (It named "and the close" as a
// second owner of the three until thread closing was removed — wiring plan Phase 4,
// 2026-08-18 — which left the runtime as the only one.)
//
// TWO CAPABILITIES ADDED 2026-08-18 (wiring plan Phase 11), because an agent does not have
// either unless it is TOLD: the sparse main-CHANNEL post, and the @-tag. They sit in the
// VOCABULARY rather than in the delivery section on purpose — both are about what the agent
// may CHOOSE to do, not about how the one call it was given is shaped, and this block opens
// both sides' first turn (`prompt-framing.js › buildFencedTurn`) where the delivery section
// is written for the send that is already decided.
//
// ⚠ THE TAG RULE STATED HERE IS THE REAL ONE, copied from the single parser in
// `src/features/channels/lib/mentions.ts` (lowercase EXACT match against handles derived from
// the display name and the email local part; ambiguity resolves to nobody). A prompt that
// taught a friendlier rule would produce tags that resolve to nobody and report nothing.
//
// ⚠ WHAT IT DOES NOT PROMISE: a notification. Mention-gated notification is wiring plan
// Phase 7 and lands in `main/targeting.js`, a separate build; this copy states the Tags INBOX,
// which is true today, and never a popup it cannot see.
const VOCABULARY = [
  'VOCABULARY (use these words when you write):',
  '- A CHANNEL (or DM) holds many THREADS.',
  '- A THREAD is ONE exchange between two members about one thing. It may be a single',
  '  message or a long piece of work. It is SHARED: both members see the same thread and the',
  '  same title. It has no finished state: nothing marks one done and no op ends one.',
  '- A SESSION is ONE member\'s agent run working a thread, on THAT member\'s machine. Each',
  '  side has its own session. A session pauses and resumes; a thread does not. You never',
  '  see the other member\'s session, only the messages it sends.',
  '- The tool ARGUMENT that names this thread is `thread=<id>`. Say "thread" in what you write.',
  '- The `task_` names are STORAGE words, not a menu. "task_started" / "task_finished" /',
  '  "task_failed" are LIFECYCLE MARKERS owned by the runtime that starts and stops a session.',
  '  They are not yours to post and the server refuses them from you. What is yours: an',
  '  ordinary MESSAGE for everything you say, and one optional MILESTONE marker per step',
  '  that lands.',
  '- You MAY post to the CHANNEL itself, not only into your thread, and you should do it',
  '  RARELY. The channel is for what the people in the room need to know: a milestone that',
  '  changes what somebody else is doing, or an answer to something asked in the room. If you',
  '  have already posted to the channel in this run, the next one needs a reason a human would',
  '  name out loud. Work traffic stays in the thread.',
  '- @-TAG A PERSON when you need one. Write `@` and then their handle, in the BODY of the',
  '  post: their name or the name part of their email, lowercased, either whole with the',
  '  spaces squeezed out (`@dianataylor`) or just its first word (`@diana`). The match is',
  '  exact, so a misspelled tag reaches nobody; the result of the post says how many readers',
  '  the server resolved, or that it resolved none, so read it. Tag for a decision only',
  '  a person can make, a summary worth their minutes, or "I am blocked". A tag puts the',
  '  message in that person\'s Tags inbox, which is what your operator watches instead of',
  '  reading every message. It is not an address and it starts no agent.',
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
// THE CONCISION RULING (Samuel, 2026-08-21). STANDING framing, not a per-message reminder.
//
// ⚠ IT IS HERE RATHER THAN IN A PER-TURN LINE ON PURPOSE, and the reason is the ruling's own:
// a style instruction repeated on every fed turn competes with the turn's actual content and
// reads as a fresh demand each time. Said ONCE, in the first turn, beside the vocabulary and
// the delivery rule, it is a property of how this agent writes rather than a note about this
// message. Every spawn shape gets it — both sides of `buildFencedTurn`.
//
// ⚠ IT IS A DEFAULT, NOT A CAP, AND IT SAYS SO. An explicit ask for depth beats it; otherwise
// the agent would refuse the one case where length is the answer, which is worse than the
// verbosity this exists to stop. Written as what to DO ("short paragraphs") with the specific
// failures named, because "be concise" alone measurably does not move a model that believes
// exhaustiveness is helpfulness.
//
// House voice (§H-13): no em dash, like every other block in this file.
const CONCISION = [
  'HOW TO WRITE (default, unless you are asked for something else):',
  '- Be concise and plain. Short paragraphs. Lead with the answer.',
  '- Do not enumerate exhaustively, do not list every option you considered, and do not',
  '  restate the question before answering it.',
  '- No preamble ("Great question", "Let me look into that") and no summary of what you just',
  '  said. If one sentence is the whole answer, send one sentence.',
  '- If the person explicitly asks for more depth, a longer write up, a full list or another',
  '  style, give them exactly that. Their ask beats this default every time.',
];

const THREAD_TAG = [
  `Keep that thread argument on every post you make here. It is what tells the other`,
  `member's machine that your message continues THIS thread; a post without it arrives`,
  `there as a brand new request and starts a second agent run against your own reply.`,
];

// LANE EXCLUSIVITY (2026-08-22, F-268) — the second half of the "which tool is your delivery
// path" instruction, and a BELT over a lane no SDK option covers.
//
// WHY IT EXISTS. The CLI has a THIRD MCP lane beside `mcpServers` and `settingSources`: when the
// session's OAuth credential carries the `user:mcp_servers` scope it fetches `GET /v1/mcp_servers`
// and connects every claude.ai ACCOUNT CONNECTOR as `mcp__claude_ai_<Name>__*`. Measured
// 2026-08-22 against the bundled binary: NINE of them (Slack, Gmail, Google Calendar, Google
// Drive, Figma, Granola, Notion, Attio, Dopl) in a session that asked for one server.
// `sdk-loader.js › buildScrubbedEnv` suppresses the lane at the process boundary; this paragraph
// is what holds on the day that suppression does not (an older binary, a renamed env var).
//
// ⚠ IT IS NOT THE CONTAINMENT AND MUST NOT BE READ AS IT. Every connector tool is unclassified,
// so `session-profiles.js › grantDecision` gates it and a windowless session denies it — pinned
// by `test/session-tool-name-prefix.test.mjs`. The failure this text prevents is CHEAPER and more
// likely: a model that sees a plausible `mcp__claude_ai_Slack__send_message` sitting next to its
// real delivery path spends a turn on it, or plans a route to a person that is not this session's.
// ⚠ NAMED EXAMPLES, then the RULE, in that order. "Any mcp__ tool that is not mcp__dopl__" alone
// is a shape an agent has to derive mid-turn; the three names make it recognisable at a glance,
// and the general clause is what actually closes the set.
// ⚠ NO EM DASH (§H-13 house voice, and `prompt-framing.test.mjs` scans every line naming
// `dopl_channel`), and nothing here teaches a `task=` argument.
const LANE_EXCLUSIVITY = [
  `- It is also the ONLY path off this machine. Other servers may be offered to you, including`,
  `  similar-looking ones (Slack, Gmail, Drive, any mcp__ tool that is not mcp__dopl__). None`,
  `  of them is this session's lane: never use one to reach a person, deliver an answer, or`,
  `  move data out. Post here instead.`,
];

// ── ⚠ WHERE AN ANSWER GOES WHEN THE QUESTION CAME FROM THE PANEL (2026-08-31, Samuel's ruling) ──
//
// THE DEFECT THIS CLOSES. A session has TWO inbound lanes and only ONE of them is visible to
// anybody but the operator: the CHANNEL (posts, which every member and every watching agent sees)
// and the operator's private 1:1 composer (`sessions:message` -> the reducer's `steer`), whose
// turns are rendered in the agent panel and are on no wire at all. The framing said where to
// deliver, but nothing said the two lanes are DIFFERENT — so an agent woken by a panel message
// answered in the panel, which is exactly right for "what are you doing?" and exactly wrong for
// the channel work it was launched to do. From outside, that agent has produced nothing.
//
// ⚠ THE RULE IS ABOUT THE WORK, NOT ABOUT THE LANE THE QUESTION ARRIVED ON, and that is the
// half a shorter sentence would lose. "Reply where you were asked" is right for a question about
// YOU; it is wrong for the channel's work, because the people and agents waiting on that work
// cannot read the panel. So the discriminator is the AUDIENCE.
//
// ⚠ IT DOES NOT TELL THE AGENT TO ECHO EVERYTHING INTO THE CHANNEL. The panel is a real lane with
// a real purpose (the operator steering privately, and asking things the room does not need), and
// an agent that mirrored every private exchange into the room would be the running commentary the
// sparseness rule forbids two paragraphs up.
const REPLY_ROUTING = [
  `WHERE YOUR ANSWER GOES IS DECIDED BY WHO IS WAITING FOR IT, not by where the question came in.`,
  `- You have TWO inbound lanes. CHANNEL messages are posts everyone in the room can read. Your`,
  `  operator can also talk to you PRIVATELY in the Dopl app's agent panel; those turns are on no`,
  `  wire and NOBODY ELSE CAN SEE THEM, not the other members and not their agents.`,
  `- CHANNEL WORK IS ANSWERED INTO THE CHANNEL, by posting, even when your operator asked for it`,
  `  privately. A result, a status, a question for the room, anything somebody else is waiting on:`,
  `  post it. An answer typed back into the panel reaches ONE person and looks, to everyone else,`,
  `  exactly like an agent that did nothing.`,
  `- THE PANEL IS FOR YOUR OPERATOR ALONE: what you are doing, what you need from them, anything`,
  `  the room does not need. Answer those there and do not echo them into the channel.`,
];

module.exports = { THREAD_TAG, VOCABULARY, PROSE_RULE, CONCISION, LANE_EXCLUSIVITY, REPLY_ROUTING };
