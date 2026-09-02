/**
 * THE PUBLISHED INPUT SHAPE for `dopl_channel` — one flat schema of optional
 * params, plus the `op` discriminator, with the per-op requirements enforced at
 * runtime by `missingParams` in the registrar.
 *
 * This is the DECLARED SURFACE an MCP client introspects (names, types, caps,
 * per-param teaching); the registrar is routing. ⚠ The parity suite reads both:
 * every declared param must be referenced by some handler in the `channel-*`
 * group, and no handler may read an arg not declared here.
 *
 * ⚠ Caps and minimums HAND-MIRROR the routes' zod schemas
 * (src/features/channels/schema.ts): title 200, body 16000, summary 2000 (a
 * post's summary is 200), client_msg_id 200, `.min(1)` on body /
 * client_msg_id / title. Declared here they publish as maxLength and are
 * enforced before the call; omit one and the route rejects it as an opaque 400
 * the write ops mis-narrate. `.trim()` where — and ONLY where — the route trims
 * before measuring, so the two agree on what "200 characters" counts.
 *
 * ⚠ `summary` used to serve two routes with two caps (post 200, close 2000) and
 * declared the LOOSER so a legitimate close summary was never refused
 * client-side. The close is gone (wiring plan Phase 4, 2026-08-18) and the
 * declared max stays at 2000 anyway: the route enforces 200 and is the
 * authority, and tightening it here would turn a route 400 that names the field
 * into an opaque client-side -32602. The tighter number is in its `.describe()`.
 */

import { z } from "zod";
import {
  AWAIT_HOLD_CAP_MS,
  AWAIT_HOLD_DEFAULT_MS,
  AWAIT_HOLD_EXTERNAL_DEFAULT_MS,
} from "./channel-await-budget";

export const CHANNEL_INPUT_SHAPE = {
  op: z
    .enum([
      // ⚠ THE DOCTRINE DOOR (T10, 2026-09-02). Returns the standing rules for
      // this surface — the same text as the MCP resource
      // `dopl://doctrine/channels`, for a client that lists tools and nothing
      // else. Takes no arguments, reads nothing, and is NOT in
      // `gating.ts › WRITE_OPS`.
      "help",
      "list",
      "open",
      "invite",
      "post",
      // ⚠ MILESTONE is its own op rather than a `kind` an agent picks on
      // `post` — see the `kind` field below.
      "milestone",
      "read",
      "await",
      "members",
      "list_threads",
      "get_thread",
      // The CALLER'S OWN live sessions: handle, state (working/idle/ended) and
      // thread. Read-only and own-scoped; `channel` narrows to one channel.
      "read_sessions",
      "create_thread",
      // ⚠ TWO OPS LEFT THIS ENUM with thread closing (wiring plan Phase 4,
      // 2026-08-18): "propose_close" (the agent's terminal act) and
      // "close_thread" (kept as a teaching refusal naming its replacement).
      // Neither may come back as a WORD either — `channel-law.test.ts ›
      // REMOVED_VOCABULARY` scans every string literal in this file.
      "set_thread_mode",
      // ⚠ DIRECT one of the operator's OWN running agents, PRIVATELY. A
      // mailbox row the operator's own machine claims and delivers into that
      // agent's private turn — it reaches no other member and no other machine.
      "direct_agent",
      // What I have asked my own agents, and what came back.
      "read_directions",
      // ASK THE OPERATOR'S DESKTOP TO START AN AGENT on a channel. ⚠ A REQUEST,
      // never a command: the desktop may refuse, and the refusal is one of seven
      // reasons. `channel` required; the hold is bounded and a timeout is a
      // PENDING directive, not a failure.
      "launch_agent",
      // ⚠ MANAGE AN AGENT THE OPERATOR IS ALREADY RUNNING (2026-09-01, Samuel's
      // ruling). The SAME mailbox `launch_agent` writes, with a different KIND —
      // so the same "a machine decides, and may refuse" contract applies, and a
      // timeout is a PENDING request rather than a failure.
      // ⚠ NEITHER IS GATED BY THE LAUNCH TOGGLE, and no result may suggest
      // otherwise: that setting governs STARTING agents. `end_agent` is a stop
      // verb, `rename_agent` is display-only on one machine, and both are
      // own-operator-only by construction.
      "end_agent",
      "rename_agent",
      // ⚠ RE-POSTURE A RUNNING AGENT — the two permission axes, on ONE agent
      // (2026-09-01). Same mailbox again, a fourth KIND.
      // ⚠ **IT ASKS, IT NEVER WIDENS**, and this is the one op in the family
      // where that has to be said: the operator's machine narrows whatever is
      // asked for to that operator's own stored channel posture, so a caller
      // that reads it as "set" reports room it does not have.
      // ⚠ AND IT IS THE ONE NON-LAUNCH OP THAT **IS** GATED BY THE LAUNCH
      // TOGGLE, unlike the two above — a posture can cause compute to be spent
      // on the operator's hardware, which a stop verb and a label cannot.
      "set_agent_mode",
      // ⚠ THE INFO CARD, AND ONLY THE INFO CARD (Samuel's ruling Q12 (b),
      // 2026-08-28). The same route accepts name / topic / archived, and this op
      // deliberately does not — see `channel-ops-update.ts`. Omitting
      // `info_card` READS the current card and changes nothing, which the
      // replace-whole contract requires.
      "update",
      // ASK A HUMAN A STRUCTURED QUESTION. ⚠ A `post` under the hood — it goes
      // to the channel like any other message and is read by everyone in it —
      // but the four fields are validated and stamped, so the surface renders
      // them as a CARD WITH BUTTONS and the choice comes back to you as a reply.
      "escalate",
      // ⚠ THE OUT-OF-BAND SIGNAL, AND IT IS NOT A POST. One recipient, three
      // words, no room: it does not fan out, it cannot end an `await`, and its
      // `seq` is its own cursor space. It exists because an agent that FINISHES
      // had no instrument at all — an unaddressed post starts nobody, and an
      // addressed one shouts at a whole channel and triggers a machine.
      "ping",
      // The inbox behind it. Read-only and recipient-scoped: what was sent TO
      // ME, never what was sent to anybody else.
      "pings",
    ])
    .describe("Operation to perform."),
  channel: z
    .string()
    .optional()
    .describe(
      'Channel slug or id. Required for every op except six, and on three of those OMITTING it is a WIDER read, not a missing argument: "read" (omit it, with `since`, for new messages across every channel you are in, in EVERY workspace and home container at once), "read_sessions" (omit it to see every session of yours EVERYWHERE, not just this workspace), "await" (omit it to hold across every channel you are a member of at once, instead of one). The other three never take it: "open" creates a channel, "list" lists them all, and "pings" is your own inbox, which spans every channel already.',
    ),
  direct: z
    .boolean()
    .optional()
    .describe(
      'op="open": set true to open a direct (1:1) message instead of a named channel — pass `member` (no name). Reuses the existing DM if one already exists.',
    ),
  name: z
    .string()
    .optional()
    .describe(
      'op="open" (required for a channel; omit for a direct message): the channel name (1-120 chars). op="rename_agent" (required): the DISPLAY NAME to give that agent on your operator\'s machine — 1-60 visible characters on ONE line, or the EMPTY STRING to clear it back to "Agent #<id>". ⚠ DISPLAY ONLY: `@agent-<id>` stays the only address, nothing resolves an agent by its name, and the name is stored on that one desktop and reaches no server — so read_sessions will keep printing the id and that is correct, not a stale read.',
    ),
  topic: z
    .string()
    .optional()
    .describe('op="open": optional one-line topic / purpose for the channel.'),
  visibility: z
    .enum(["private", "public"])
    .optional()
    .describe(
      'op="open": "private" (default, invite-only) or "public" (any workspace member can see and join).',
    ),
  member: z
    .string()
    .optional()
    .describe(
      'op="invite" (required) / op="open" with direct=true (required): the member — an email or user id of an ACTIVE workspace member.',
    ),
  intent: z
    .enum(["chat", "request"])
    .optional()
    .describe(
      'op="post" (optional, default "request"): what this message IS. "request" is the working message: it may address a PERSON with `to`, and `to` is the ONLY thing that puts a post in front of somebody\'s side — nothing is addressed for you, a DIRECT (1:1) channel included. "chat" is PEOPLE TALKING: it addresses nobody and starts nobody, and it SAYS SO on the wire, so the receiving side can tell a deliberate aside from a request that forgot to name anyone. "chat" together with `to` is a contradiction and is REFUSED (nothing is sent) rather than resolved one way — drop the address, or post as a "request".',
    ),
  body: z
    .string()
    // ⚠ `.min(1)` mirrors the route on BOTH the post and create_thread schemas.
    .min(1)
    .max(16000)
    .optional()
    .describe(
      'op="post" / op="create_thread" / op="milestone" (required): the message text, <=16000 characters. For op="post" this is what you are actually saying, and it is a normal message whatever it contains — a half-sentence, a status line, or the finished deliverable. For op="milestone" it is ONE LINE naming the step that just landed, nothing more (content does not travel in a milestone; nobody reads one as an answer). For create_thread, it is the requester\'s initial request. op="ping" (required): ONE LINE, <=600 characters — what you are signalling, not the report. The thread you point at is where the report lives, and a ping long enough to be read as one is a ping nobody reads.',
    ),
  to: z
    .string()
    .optional()
    .describe(
      'op="post" / op="create_thread" (required for create_thread): address to one channel member — an email or user id (resolved like invite\'s member). For post it makes the message a REQUEST that triggers that member\'s listener and can start their agent, so name someone only when you are asking for their machine. Omit it for talk nobody must act on — and say so outright with `intent`="chat", which addresses nobody even in a direct channel. A channel reaches PEOPLE: there is no way to address an agent by name. For create_thread, it is the member the thread is for. op="ping" (one of three recipient forms): file the signal in that PERSON\'S inbox. ⚠ Unlike a post it does NOT trigger their machine — it waits to be read, which is the point.',
    ),
  // ⚠ One param, one route now. The declared 2000 is deliberately LOOSER than
  // the post route's 200 so an over-length summary is the route's to reject,
  // with the field named, rather than an opaque client-side -32602.
  summary: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .describe(
      'op="post": a short one-line intent (<=200 chars). ALWAYS set it — it becomes the notification the receiving member sees.',
    ),
  // ⚠ The kinds are NOT a vocabulary to pick from — the describe must say whose
  // each one is. Listing five names with no rule gets a finished responder to
  // post its ANSWER as `task_finished`, whose BODY appears nowhere: the web
  // reader renders a terminal lifecycle row as a slim flag-derived RECEIPT LINE
  // ("Finished", "Declined") and never as the text that was posted
  // (`channels-v2/view-model.ts › toReceiptRow`, over
  // `channels/lib/message-receipt.ts › lifecycleReceiptStatus`, 2026-08-18);
  // `task_started` is dropped outright. Before wiring plan Phase 5 the reason
  // was a session card folding the marker into its `endEvent`; the card is gone
  // and the outcome for an answer posted this way is the same — it vanishes.
  //
  // ⚠ The enum keeps all five ON PURPOSE — narrowing turns the mistake into an
  // opaque zod -32602 exactly when the agent needs telling what to do instead.
  kind: z
    .enum([
      "message",
      "task_started",
      "task_progress",
      "task_finished",
      "task_failed",
    ])
    .optional()
    .describe(
      'op="post": LEAVE THIS UNSET. The default, "message", is what every substantive thing you send is — including your FINAL ANSWER. The other four keep the older `task_` storage names and are NOT interchangeable with it: "task_started" / "task_finished" / "task_failed" are LIFECYCLE MARKERS owned by the runtime that starts and stops a session, and this tool REFUSES them from you (a body written into one is not rendered on the other member\'s thread card at all, so an answer sent as one is delivered nowhere). "task_progress" is the milestone lane and is yours, but you do not need this field for it either: op="milestone" posts one with no kind to pick.',
    ),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'op="post": optional JSON object of structured fields for task_* events (e.g. {taskId, durationMs, refs}).',
    ),
  // ⚠ THE TWO ROUTES DEDUPE OVER DIFFERENT KEYS, AND THE DESCRIBE SAYS SO —
  // `channel_messages` is unique on `(channel_id, client_msg_id, author_user_id)`
  // (`20260822120000_channel_messages_author_scoped_idempotency.sql`) while
  // `channel_tasks` is unique on `(channel_id, client_msg_id)`
  // (`20260729032037_channel_tasks_client_msg_id.sql`, still the live index).
  // One sentence covering both would have to be the WEAKER of the two, and the
  // weaker one is wrong in the direction that costs a duplicate.
  client_msg_id: z
    .string()
    // ⚠ `.min(1)` mirrors the route — a blank idempotency key is not a key, and
    // a client-side refusal keeps the caller from believing it deduped anything.
    .min(1)
    .max(200)
    .optional()
    .describe(
      'op="post" / op="create_thread": optional idempotency key. For op="post" the dedupe is PER-AUTHOR: re-sending the same op with the same id FROM THE SAME ACCOUNT will not create a duplicate, and two different members may use the same id — both messages post, and neither suppresses the other. For op="create_thread" it is wider: the id is unique per CHANNEL whoever sent it, so a repeat returns the already-created thread instead of opening a second, and a key another member already used in this channel hands you back THEIR thread with your body posted nowhere. Use it whenever a retry is possible; any stable string of your own is fine, and one you namespaced to yourself is safest.',
    ),
  // ⚠ THE PROMISE IS ABOUT ORDER *WITHIN* THE CALL, NOT ABOUT PRECEDENCE OVER
  // EVERYTHING ELSE (softened 2026-08-24). It read "rejected here, before the
  // call is made", which claimed this bound is the FIRST thing anything checks.
  // It is not: a desktop agent session runs `create_thread` through its own
  // permission gate first (`dopl-desktop-app/main/session-profiles.js ›
  // grantDecision`), so a held or refused call never reaches zod at all and the
  // agent gets a permission answer where the copy promised a title answer. What
  // IS true, and is all this can honestly say, is that once the call is allowed
  // to run the bound is enforced client-side before anything crosses the wire.
  title: z
    .string()
    .trim()
    // ⚠ `.min(1)` mirrors the route and is measured AFTER the trim on both
    // sides, so a whitespace-only title is refused here rather than 400ing.
    .min(1)
    .max(200)
    .optional()
    .describe(
      'op="create_thread" (required): the thread title (1-200 chars) — a short header for the exchange, not a description. When the call is permitted to run, the bound is checked before anything goes on the wire, so an over-length title costs nothing and nothing is sent — shorten it rather than resending it unchanged.',
    ),
  mode: z
    .enum(["interactive", "autonomous"])
    .optional()
    .describe(
      'op="create_thread" (optional, default "interactive") / op="set_thread_mode" (required): the thread execution mode.',
    ),
  handoff: z
    .boolean()
    .optional()
    .describe(
      'op="create_thread" (optional, default false): SPAWN-WITH-HANDOFF. Set true when YOU are an external agent (this Claude Desktop / Claude Code) opening a thread that your operator\'s Dopl app should then DRIVE — a full session opens on their machine and carries the conversation, instead of this external session keeping it. Default (omitted/false) is unchanged: the thread is created and THIS session keeps the reply, nothing opens on their machine. Only meaningful on YOUR OWN operator\'s create — the desktop honors it only for a thread you created as yourself, so it can never open a window on anyone else\'s machine. Use it when the operator asked you to "spin up an agent on Dopl to talk to <someone> about X"; leave it off when you are the one who will handle the replies here.',
    ),
  thread: z
    .string()
    .optional()
    .describe(
      'op="get_thread" / op="set_thread_mode" / op="milestone" (required): the thread id (returned by create_thread). ⚠ For get_thread this returns the thread\'s METADATA ONLY — title, mode, the two parties, timestamps — and NO message bodies; to read what was said, use op="read" with thread=<id>. op="post" (optional): thread this post under that thread. op="launch_agent" (optional): start the agent ON that thread, so its posts land in that exchange. op="read" (optional): filter the transcript to that one exchange — only messages tagged with this thread id come back. It FILTERS, so an id no message carries returns nothing rather than an error, and `await` has no counterpart (it is never thread-scoped, with or without a channel). op="ping" (optional): point the signal at that exchange, so whoever reads it can open the work in one click.',
    ),
  // ⚠ `agent_id`, NOT `agent`. `channel-addressing-rule.test.ts` bans a param
  // literally named `agent` — it was the retired named-agent ADDRESSING surface,
  // and "a param an MCP client can see is a param a model will try". This one
  // names an INSTANCE ID on the caller's own machine and addresses nobody in the
  // channel, which is exactly the distinction that guard exists to keep.
  agent_id: z
    .string()
    .optional()
    .describe(
      'op="direct_agent" / op="end_agent" / op="rename_agent" / op="set_agent_mode" (required): WHICH of your operator\'s agents to act on — the 8-character instance id. dopl_channel(op="read_sessions") prints it as `@agent-<id>`; you may paste either that whole handle or the bare id, both are accepted. op="read_directions" (optional): narrow the listing to that one agent. ⚠ There is NO oldest-agent fallback on ANY of these lanes, deliberately: guessing which agent you meant would direct, end or relabel one you did not address, with nothing reporting the swap — and on an end that is unrecoverable. ⚠ YOUR OWN OPERATOR\'S AGENTS ONLY. An id belonging to another member is REFUSED outright and no request is filed; a peer\'s agent is a handle you can read about and nothing you can reach.',
    ),
  // ⚠ TWO PARAMS FOR ONE OP, and neither could be folded into an existing one.
  // `kind` is a CLOSED enum of message kinds and widening it would let a post
  // claim it was "done"; `to`/`agent_id` already carry the other two recipient
  // forms, so only "my own operator's external session" had no spelling.
  // ⚠ THERE IS NO PARAM FOR *WHOSE* MACHINE, ON PURPOSE. Both self-scoped forms
  // resolve to the authenticated caller's own operator, server-side, and that
  // absence is the whole of the loop brake: you cannot ping another member's
  // agent because there is no argument with which to name one.
  ping_kind: z
    .enum(["done", "question", "blocked"])
    .optional()
    .describe(
      'op="ping" (required): WHAT you are signalling. "done" — the work is finished; this is the one nothing else could say, and an agent that ends without it ends invisibly. "question" — you need an answer to continue (this is NOT op="escalate", which offers a human buttons to press; a question ping says "come look" and the thread holds the question). "blocked" — you cannot continue and are not asking a question: a credential, a dependency, a decision elsewhere.',
    ),
  to_desktop: z
    .boolean()
    .optional()
    .describe(
      'op="ping" (one of three recipient forms): set true to signal YOUR OWN operator\'s external session — the one holding the ping inbox open. This is what an agent uses to say "I have finished, come and look" to the human\'s own assistant, and it is the reason this op exists: nothing else could reach that session without the operator asking first.',
    ),
  // ⚠ `outcome` ("completed" | "failed") was a param here, required by
  // op="propose_close" alone. It left with thread closing (wiring plan Phase 4,
  // 2026-08-18); nothing in this surface has an outcome any more.
  // ⚠ coerce: MCP clients sometimes send numbers as strings, and strict
  // z.number() rejects those with an opaque -32602.
  since: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'op="read": return only messages with seq greater than this. op="await" (ALWAYS required, with or without `channel`): the last seq you have processed. `seq` is workspace-global, which is what lets ONE cursor cover every channel at once when you omit `channel`. ⚠ WHERE TO GET ONE, because there is a page that deliberately will not give you one: a THREAD-SCOPED read (op="read" with `thread`) offers NO cursor at all and says so — it filtered other exchanges out, and `await` is channel-wide with a strict "greater than", so a seq taken off that page would permanently skip every message the filter hid. Establish the cursor from an UNSCOPED read (drop `thread`) and carry that page\'s highest seq. op="pings" (optional): return only pings with a higher ping seq than this. ⚠ **A PING SEQ IS NOT A MESSAGE SEQ.** They are separate cursor spaces, so crossing them reads a plausible WRONG page instead of erroring — carry the one op="pings" itself printed.',
    ),
  goal: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .optional()
    .describe(
      'op="launch_agent" (optional, but you almost always want it): what the agent should DO, in your own words (<=2000 chars). It becomes that agent\'s opening instruction. Say what "done" looks like, and ask it to post a milestone (op="milestone") when each work item starts and finishes — those milestones are what come back to you on your next await, attributed to the agent that posted them. With no goal, an agent starts with nothing to do and waits.',
    ),
  model: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe(
      'op="launch_agent" (optional): the model to run the agent on. Omit it to use whatever the operator has set for that channel — which is the right default and what you should do unless you were told otherwise. An id that machine does not recognize is NOT refused — it silently FALLS BACK to whatever the channel is set to, and nothing tells you it did, so pass a model only when you were told which one.',
    ),
  // ⚠ ID **OR** EXACT NAME, in ONE param — `dopl_kb`'s `base` already works this
  // way (`knowledge-shared.ts`), so this reuses the tree's idiom rather than
  // inventing a second convention. Bounded at 120, `agent_templates.name`'s own
  // cap, so a legal name is never refused client-side as an opaque -32602.
  template: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe(
      'op="launch_agent" (optional): the AGENT TEMPLATE the new agent should run as — its id, or its exact name. A template is a saved identity (instructions, a default model, custom fields, attached knowledge bases) that your operator wrote; omitting this starts a blank agent, which is the right default unless you were told to use one. ⚠ IT IS RESOLVED UNDER **YOUR** VISIBILITY WHEN YOU ASK AND UNDER **THE OPERATOR\'S** WHEN THEIR MACHINE STARTS IT — two different people — so a private or team template of yours can be refused there with "could not resolve the TEMPLATE you named". ⚠ IF A NAME MATCHES MORE THAN ONE TEMPLATE YOU CAN SEE, THE CALL IS REFUSED AND EVERY MATCH IS LISTED WITH ITS ID: pick one and re-issue with the ID. Names are deliberately not unique, so nothing here guesses for you.',
    ),
  // ── ⚠ THE TWO PERMISSION AXES (2026-09-01, T24 + the re-posture verb) ───────
  //
  // ⚠ **THE ENUM MEMBERS ARE ORDERED NARROWEST FIRST AND THAT ORDER IS THE
  // CONTRACT.** The operator's machine clamps by INDEXING into a copy of these
  // sequences, so re-ordering either one silently inverts the bound. It is also
  // the order a reader of the published schema will assume is a ranking, which is
  // the one assumption here that happens to be true.
  // ⚠ **ONE PARAM SERVES BOTH THE LAUNCH AND THE RE-POSTURE**, deliberately: it
  // is the same axis with the same four values and the same clamp, and two names
  // for one thing is how a caller learns to guess which one an op wants.
  tools: z
    .enum(["manual", "accept_edits", "auto", "bypass"])
    .optional()
    .describe(
      'op="launch_agent" / op="set_agent_mode" (optional): HOW MUCH TOOL FREEDOM to ask for, narrowest first — "manual" (every tool call waits for your operator), "accept_edits" (file edits go through, the rest waits), "auto" (work tools go through), "bypass" (widest). ⚠ YOU ARE ASKING, NOT SETTING. Your operator\'s machine narrows whatever you ask for down to the ceiling THEY chose by hand in their own settings, and it never widens past it — so asking for "bypass" does not give you bypass, and there is no argument, account or wording that changes that. Omit it to run at their stored setting, which is what almost every call should do. ⚠ Whether you were narrowed is reported back only if that machine says so; when it says nothing, the result prints "not reported" and you must not assume you got what you asked for.',
    ),
  messages: z
    .enum(["ask", "auto_inbound", "auto_outbound", "auto_both"])
    .optional()
    .describe(
      'op="launch_agent" / op="set_agent_mode" (optional): HOW MUCH MESSAGE FREEDOM to ask for, narrowest first — "ask" (your operator sees every message first), "auto_inbound" (incoming flows), "auto_outbound" (its posts flow), "auto_both" (widest). ⚠ ASKED FOR, NOT SET — clamped to your operator\'s own ceiling exactly as `tools` is, and additionally held to a floor for a session with no window of its own. Omit it to run at their stored setting.',
    ),
  chain: z
    .boolean()
    .optional()
    .describe(
      'op="launch_agent" (optional): may the new agent launch further agents of its own? ⚠ THREE STATES, AND OMITTING IT IS NOT THE SAME AS false. Pass true to ASK FOR chaining; pass false to ask that chaining be OFF for this agent; omit it to say nothing, in which case the agent inherits whatever your operator\'s channel is already set to — which may be ON. ⚠ true IS REFUSED RATHER THAN QUIETLY NARROWED when the channel does not allow it (unlike `tools` and `messages`) — you get an answer instead of an agent that hits a wall mid-run after you have already handed it work that assumes workers. ⚠ false IS ALWAYS GRANTED and WINS over a channel set to ON: it only ever narrows, so there is nothing for your operator\'s setting to protect. Ask for true only when the work genuinely needs sub-agents; pass false when you want a worker that cannot spawn more.',
    ),
  wait_ms: z.coerce
    .number()
    .int()
    .min(0)
    .max(30_000)
    .optional()
    .describe(
      'op="launch_agent" / op="end_agent" / op="rename_agent" / op="set_agent_mode" (optional, default 15000, max 30000): how long to hold waiting for the operator\'s desktop to accept or refuse. ⚠ A TIMEOUT IS NOT A FAILURE — the request stays PENDING and the desktop may still take it; the result tells you the directive id and says to check read_sessions. Do not re-issue on a timeout: on a launch you would queue a SECOND agent, and on an end or a re-posture you would have no way to tell which request acted.',
    ),
  info_card: z
    .object({
      hidden: z
        .array(z.string())
        .max(3)
        .optional()
        .describe(
          'Built-in rows to HIDE, by key: "email", "created", "lastActivity". Hiding a row changes what this CARD shows and nothing else — it does not clear anybody\'s email.',
        ),
      rows: z
        .array(
          z.object({
            id: z
              .string()
              .max(64)
              .optional()
              .describe(
                "Omit on a NEW row (one is minted for you); pass it to EDIT the row that already has it. Ids must be unique within a card.",
              ),
            label: z.string().min(1).max(40).describe("The left column — one short line."),
            value: z.string().max(200).optional().describe("The right column. May be empty."),
          }),
        )
        .max(12)
        .optional()
        .describe("The card's CUSTOM rows, at most 12."),
    })
    .optional()
    .describe(
      'op="update": the channel\'s whole info card. ⚠ REPLACES IT — a write that omits a row DELETES that row, and `info_card={}` clears the card. OMIT this argument entirely to READ the current card without changing it, which is how you get the rows to send back. Everyone in the channel sees this card.',
    ),
  // ── op="escalate" ────────────────────────────────────────────────────────
  // ⚠ FOUR SEPARATE PARAMS RATHER THAN ONE `escalation` OBJECT, deliberately.
  // The whole point of the op is that an agent has to SAY the four things; a
  // nested object lets a model fill one key with a paragraph and satisfy the
  // schema. Caps mirror `src/features/channels/escalation.ts` — sync all three
  // (that file, this one, `channel-errors.ts › FIELD_CAPS_NOTE`).
  issue: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'op="escalate" (required): the question, in ONE line (<=200 chars). Not a summary of your work — the decision you cannot make. It becomes the card\'s title, so write it as the thing a person has to answer.',
    ),
  context: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .describe(
      'op="escalate" (optional, <=2000 chars): what a person needs to know to choose, and nothing else. Do not restate the options here and do not narrate what you tried — the options carry their own consequences, and a card that has to be read twice is the prose wall this op replaces.',
    ),
  options: z
    .array(
      z.object({
        label: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .describe("The button's face — one short imperative, <=80 chars."),
        consequence: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe(
            "ONE line saying what happens if they press it (<=200 chars). Required on every option: an option with no stated consequence makes the reader do your analysis.",
          ),
      }),
    )
    .min(2)
    .max(6)
    .optional()
    .describe(
      'op="escalate" (required): 2-6 things a person could decide. ⚠ BOTH BOUNDS ARE REAL. ONE option is not a question — if there is only one way forward, take it and report with op="milestone". More than six is the wall of prose again with numbers on it; collapse the near-duplicates first.',
    ),
  recommendation: z
    .object({
      index: z
        .number()
        .int()
        .min(0)
        .describe("0-based index into `options` — the one you would take."),
      why: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .describe("ONE line for why (<=200 chars)."),
    })
    .optional()
    .describe(
      'op="escalate" (optional but almost always right): which option you would take and why. You did the work; a card that offers four choices and no opinion pushes the whole analysis back onto the person you interrupted. ⚠ `index` MUST be inside `options` — an out-of-range one refuses the whole call rather than posting a card that recommends nothing.',
    ),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'op="read": max messages to return (1-200, DEFAULT 100). Omitted with no `since`, that is the NEWEST 100 — older messages are absent, not reported as absent. op="pings": max pings to return (1-100, DEFAULT 20).',
    ),
  timeout_ms: z.coerce
    .number()
    .int()
    .min(0)
    .max(AWAIT_HOLD_CAP_MS)
    .optional()
    .describe(
      `op="await": TOTAL time to hold before returning with no messages (milliseconds, max ${AWAIT_HOLD_CAP_MS}). The hold is assembled server-side out of ~50s polls re-issued with the same cursor, so it returns the instant a message arrives. OMITTED, the default fits YOUR client: ${AWAIT_HOLD_EXTERNAL_DEFAULT_MS} for an external one (most MCP clients abort a call around 60s, and an aborted call returns no cursor and no re-arm instruction at all), ${AWAIT_HOLD_DEFAULT_MS} for a session run by the Dopl desktop. Pass it only when you know your own client outlasts the default — an explicit value is honoured exactly, up to the max — or when you deliberately want a short check. If a hold still comes back as a raw transport timeout instead of a result, your client is capping calls below ${AWAIT_HOLD_EXTERNAL_DEFAULT_MS}: report that to your operator and poll with a smaller timeout_ms plus repeated op="read".`,
    ),
};
