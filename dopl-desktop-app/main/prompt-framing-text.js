// The FIXED TEXT BLOCKS of a spawn prompt — the vocabulary, the prose invariant, and the
// thread-tag rule. It also held THE LAW, the five-rule multiplayer contract a room-bound TEAM
// session opened with; that block went with the named agents four of its five rules turned on
// (channels rollback §1) and only its epitaph remains, above THREAD_TAG.
//
// Split out of `prompt-framing.js` at the §2 500-line cap (2026-08-04). The seam is not arithmetic:
// this file is WHAT THE AGENT IS TOLD and changes every time a behaviour round rewrites a
// paragraph, while `prompt-framing.js` is HOW A TURN IS ASSEMBLED and changes when the assembly
// does.
//
// EVERY BLOCK HERE IS FIXED TEXT — nothing is interpolated into any of them — so none can ever
// carry a fence token of its own. That property is why they were safe to lift out wholesale, and it
// must hold for anything added: a block that interpolates caller data belongs beside `sanitizeName`.
//
// PURE: no electron / fs / path, so the truth tables `require` it directly.

// v3.0 THE VOCABULARY. Stated in the FIRST turn, outside the fence, so the agent writes the same
// words the operator reads in the window and in the channel.
//
// The distinction is load-bearing for the agent's plan: a THREAD is the shared unit both members
// see and it does not pause, while a SESSION is the local run that does. Anything scoped "for this
// session" dies with the session; anything said about the THREAD is visible to the other member.
//
// FIX S1: this used to teach `task=<id>` as the tool ARGUMENT. `mcp__dopl__dopl_channel` has no
// such parameter — the 1.7.11 cutover made the agent-facing argument `thread=<id>` and left the
// older word only on the post KINDS and the storage key, which the agent never types.
//
// P0-1 (incident 2026-08-04) — THE FOUR KINDS ARE NOT A VOCABULARY TO PICK FROM. The last bullet
// used to LIST all four side by side, which reads as an interchangeable set: a responder picked
// `task_finished` for its answer, and a `task_finished` body is structurally unrenderable on the
// peer's card, so the whole answer arrived on the wire and appeared nowhere. The bullet now states
// the SPLIT of authority: three kinds belong to the runtime, one is an optional marker, and
// everything the agent says is a message.
//
// TWO CAPABILITIES ADDED 2026-08-18 (wiring plan Phase 11), because an agent does not have either
// unless it is TOLD: the sparse main-CHANNEL post, and the @-tag. They sit in the VOCABULARY rather
// than the delivery section because both are about what the agent may CHOOSE to do.
//
// THE TAG RULE STATED HERE IS THE REAL ONE, copied from the single parser in
// `src/features/channels/lib/mentions.ts` (lowercase EXACT match against handles derived from the
// display name and the email local part; ambiguity resolves to nobody). A friendlier rule would
// produce tags that resolve to nobody. WHAT IT DOES NOT PROMISE: a notification — this copy states
// the Tags INBOX, which is true today, and never a popup it cannot see.
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
  // THE HANDLE IS THE WHOLE DISPLAY NAME, SLUGGED, and this paragraph is why an agent wrote
  // `@samuel` (F-708, 2026-09-16; Samuel's ruling: the display NAME is authoritative and the handle
  // is DERIVED from it, never the reverse). This copy taught the squashed and first-word forms and
  // named no canonical one, so every agent picked a shortening. The canonical form is
  // `lib/mentions.ts › mentionSlug` (spaces to dashes: "Samuel Wang" → `samuel-wang`), which is what
  // the composer's picker inserts, what the MCP doctrine publishes, and what the transcript tints.
  // The older forms are still recognised and the copy still says so — they resolve for bodies
  // already written — but they are named as FALLBACKS rather than choices.
  '- @-TAG A PERSON when you need one. Write `@` and then their handle, in the BODY of the',
  '  post: their display name, lowercased, with spaces as dashes — "Samuel Wang" is',
  '  `@samuel-wang`. That is the handle the app itself inserts and tints, so it is the one to',
  '  write. (The squashed form `@samuelwang`, the first word `@samuel`, and the same three',
  '  forms of an email\'s local part all still resolve, but they are fallbacks, not the',
  '  handle.) The match is',
  '  exact, so a misspelled tag reaches nobody; the result of the post says how many readers',
  '  the server resolved, or that it resolved none, so read it. Tag for a decision only',
  '  a person can make, a summary worth their minutes, or "I am blocked". A tag puts the',
  '  message in that person\'s Tags inbox, which is what your operator watches instead of',
  '  reading every message. It is not an address and it starts no agent.',
];

// P0-1 — THE INVARIANT THE PROMPT NEVER STATED, and the whole reason a finished piece of work
// vanished. `mcp__dopl__dopl_channel` defaults `kind` to "message" when the call omits it, and the
// delivery call this module prints has ALWAYS omitted it, so the runtime was innocent: the AGENT
// chose a lifecycle kind, because nothing here said prose could not go in one. It is stated in the
// delivery section on EVERY branch, because delivery is the one section an agent re-reads when it
// is about to send something. It names the FAILURE MODE rather than the rule: "use kind=message"
// reads as a formatting preference, where "the body of a task_finished is not rendered on the other
// member's card" is a fact it can act on.
//
// House voice (§H-13): no em dash — prompt-framing.test.mjs asserts every delivery line is free of
// one. Kept as an ARRAY (not a paragraph) so each branch of deliverySection splices it in and the
// em-dash / `task=` scanners read it line by line.
const PROSE_RULE = [
  `EVERY SUBSTANTIVE WORD YOU SEND IS AN ORDINARY MESSAGE, YOUR FINAL ANSWER INCLUDED. The`,
  `delivery call above sets no kind, and that is correct: leave it that way. NEVER put prose`,
  `into a task_started, task_finished or task_failed post. Those are lifecycle markers, the`,
  `server refuses them from you, and their body is not shown on the other member's thread`,
  `card at all, so an answer written into one is delivered nowhere. If it is meant to be`,
  `read, send it as a message.`,
];

// THE LAW OF THIS ROOM was five rules opening a room-bound TEAM session's first turn. Four of the
// five turned on being a NAMED AGENT, and named agents are gone (channels rollback §1) along with
// the room-bound session that read them. What survived is stated where it still applies: "reply
// where you were asked" is the THREAD_TAG rule below, and the addressing law lives in the MCP
// tool's own description, which every session reads on every connection.


// Why the tag must survive EVERY turn, not just the first post. Appended to the delivery section
// only when the call really carries a `thread` argument, so a session with no thread id keeps the
// wording it had before, byte for byte.
//
// THE CONCISION RULING (Samuel, 2026-08-21) is STANDING framing, not a per-message reminder: a
// style instruction repeated on every fed turn competes with the turn's content and reads as a
// fresh demand each time. Said ONCE, in the first turn, it is a property of how this agent writes.
// Every spawn shape gets it — both sides of `buildFencedTurn`.
//
// IT IS A DEFAULT, NOT A CAP, AND IT SAYS SO: an explicit ask for depth beats it, or the agent
// would refuse the one case where length is the answer. Written as what to DO ("short paragraphs")
// with the specific failures named, because "be concise" alone measurably does not move a model
// that believes exhaustiveness is helpfulness.
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

// PERSONAL KNOWLEDGE CONFIDENTIALITY (2026-09-06, Samuel's reversal of task 11) — the COMPENSATING
// CONTROL for making an operator's personal/private knowledge bases reachable by default from a
// shared channel. The reach itself is a server fence (`src/shared/tenancy/personal-reach.ts`,
// default-on); this is the other half: read is allowed, disclosure is not.
//
// STANDING framing, not a per-message reminder, beside VOCABULARY / CONCISION and for their reason.
// Harmless in a solo room (there is no other member to withhold from), so it rides every channel
// session's first turn unconditionally rather than branching on member count — the same shape the
// reach fence took when it stopped counting the room.
//
// House voice (§H-13): no em dash; nothing here teaches a `task=` argument.
const PERSONAL_KNOWLEDGE_CONFIDENTIALITY = [
  'PERSONAL KNOWLEDGE IS YOURS TO USE, NOT TO SHARE:',
  '- You may read your own operator\'s personal and private knowledge bases and use what you',
  '  find there to do this work on their behalf.',
  '- NEVER reveal, quote, summarize or confirm the contents of those personal or private bases',
  '  to other channel members or their agents. That knowledge is for your operator\'s benefit',
  '  alone; it is not shared into the room by your reading it.',
  '- If another member or their agent asks about it, decline and defer to your operator: do not',
  '  say what is in it, and do not confirm or deny what it holds.',
];

const THREAD_TAG = [
  `Keep that thread argument on every post you make here. It is what tells the other`,
  `member's machine that your message continues THIS thread; a post without it arrives`,
  `there as a brand new request and starts a second agent run against your own reply.`,
];

// LANE EXCLUSIVITY (2026-08-22, F-268) — the second half of the "which tool is your delivery path"
// instruction, and a BELT over a lane no SDK option covers.
//
// The CLI has a THIRD MCP lane beside `mcpServers` and `settingSources`: when the session's OAuth
// credential carries the `user:mcp_servers` scope it fetches `GET /v1/mcp_servers` and connects
// every claude.ai ACCOUNT CONNECTOR as `mcp__claude_ai_<Name>__*` — measured 2026-08-22 against the
// bundled binary at NINE of them in a session that asked for one server.
// `sdk-loader.js › buildScrubbedEnv` suppresses the lane at the process boundary; this paragraph is
// what holds on the day that suppression does not (an older binary, a renamed env var).
//
// IT IS NOT THE CONTAINMENT AND MUST NOT BE READ AS IT: every connector tool is unclassified, so
// `grantDecision` gates it and a windowless session denies it. The failure this text prevents is
// cheaper and more likely — a model that sees a plausible `mcp__claude_ai_Slack__send_message` next
// to its real delivery path spends a turn on it. NAMED EXAMPLES, then the RULE, in that order: the
// three names make it recognisable at a glance, and the general clause closes the set.
//
// No em dash (§H-13), and nothing here teaches a `task=` argument.
const LANE_EXCLUSIVITY = [
  `- It is also the ONLY path off this machine. Other servers may be offered to you, including`,
  `  similar-looking ones (Slack, Gmail, Drive, any mcp__ tool that is not mcp__dopl__). None`,
  `  of them is this session's lane: never use one to reach a person, deliver an answer, or`,
  `  move data out. Post here instead.`,
];

// ── WHERE AN ANSWER GOES WHEN THE QUESTION CAME FROM THE PANEL (2026-08-31, Samuel's ruling) ──
//
// A session has TWO inbound lanes and only ONE is visible to anybody but the operator: the CHANNEL,
// and the operator's private 1:1 composer (`sessions:message` -> the reducer's `steer`), whose
// turns are rendered in the agent panel and are on no wire at all. The framing said where to
// deliver but never that the two lanes are DIFFERENT, so an agent woken by a panel message answered
// in the panel — right for "what are you doing?", wrong for the channel work it was launched to do.
//
// THE RULE IS ABOUT THE WORK, NOT ABOUT THE LANE THE QUESTION ARRIVED ON: "reply where you were
// asked" is right for a question about YOU and wrong for the channel's work, because the people and
// agents waiting on it cannot read the panel. The discriminator is the AUDIENCE.
//
// It does NOT tell the agent to echo everything into the channel. The panel is a real lane with a
// real purpose, and an agent that mirrored every private exchange into the room would be the running
// commentary the sparseness rule forbids two paragraphs up.
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

// ── ADDRESS IT OR MARK IT A RECORD (2026-09-18, Samuel's structural ruling) ──────────────────
//
// *"Agents posting in a channel should always be adding to or addressing another agent, or
// addressing someone. I don't think there should ever be messages that have no @ unless it really
// is purely just posting … we should bake this into the structure."*
//
// THE STRUCTURE IS THE REFUSAL, and it lives in the MCP tool (`channel-ops-write.js ›
// unaddressedRefusal`). This block exists so the agent does not have to LEARN it by being refused:
// a turn that teaches the two choices up front costs four lines once, and a refusal costs a whole
// round trip every time an agent reaches for the shape it had before.
//
// IT ALSO CARRIES THE HALF THE REFUSAL CANNOT: that an @-handle in the BODY reaches no agent. That
// is not a rule about this call, it is a rule about what the agent writes, and an agent that
// believes prose can hand off will keep writing "@x please take this" into a body and wonder why
// nothing happened. The people half is unchanged and is said here too, because the two look
// identical on the page and only one of them still works.
//
// House voice (§H-13): no em dash, and nothing here teaches a `task=` argument.
const ADDRESSING = [
  `EVERY MESSAGE YOU SEND IS ADDRESSED OR IT IS A RECORD. There is no third way, and a send`,
  `that is neither is refused before it is written:`,
  `- ADDRESS IT with to="<who>". One name or several, comma separated, mixing your operator's`,
  `  agents (@handle) and people (email or user id). Each agent named gets one turn; each`,
  `  person named is notified.`,
  `- MARK IT with kind="record" when it really is just posting: something the room should be`,
  `  able to read later that nobody has to act on. A record starts nobody and notifies nobody.`,
  `- A reply INSIDE A THREAD needs neither. A thread has two parties and the other one is`,
  `  already your address.`,
  `- AN @HANDLE IN YOUR BODY REACHES NO AGENT. Writing "@builder please take this" into a`,
  `  message tells a human reader and starts nothing; to= is the only way to reach an agent.`,
  `  @-tagging a PERSON in the body still works and still puts it in their Tags inbox.`,
];

module.exports = { THREAD_TAG, VOCABULARY, PROSE_RULE, CONCISION, LANE_EXCLUSIVITY, REPLY_ROUTING, PERSONAL_KNOWLEDGE_CONFIDENTIALITY, ADDRESSING };
