"use strict";
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
 * ⚠ **EVERY `.describe()` HERE IS PUSHED ON EVERY CONNECTION, EXACTLY LIKE THE
 * TOOL DESCRIPTION, AND IS BUDGETED LIKE ONE** (A6, 2026-09-02). It was 20,844
 * characters over 46 blocks — 11.7× the description the T82 cap governs — because
 * each block carried the RULE behind its field as well as its contract. A rule
 * belongs in `channel-doctrine.ts`, which is PULLED by the agent that asks for
 * it; a `.describe()` carries the CONTRACT of one field and stops. One sentence
 * each, and `channel-schema-budget.test.ts` is what keeps it there.
 *
 * ⚠ Caps and minimums HAND-MIRROR the routes' zod schemas
 * (src/features/channels/schema.ts): title 200, body 16000, summary 2000 (a
 * post's summary is 200), client_msg_id 200, `.min(1)` on body /
 * client_msg_id / title. Declared here they publish as maxLength and are
 * enforced before the call; omit one and the route rejects it as an opaque 400
 * the write ops mis-narrate. `.trim()` where — and ONLY where — the route trims
 * before measuring, so the two agree on what "200 characters" counts.
 *
 * ⚠ `summary` declares the LOOSER of the two caps it has served (2000, not the
 * post route's 200) so a legitimate summary is never refused client-side as an
 * opaque -32602: the route enforces 200, names the field, and is the authority.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHANNEL_INPUT_SHAPE = exports.PARAM_DESCRIPTION_MAX_CHARS = exports.SCHEMA_MAX_CHARS = void 0;
const zod_1 = require("zod");
const response_size_1 = require("./response-size");
/**
 * THE INPUT-SCHEMA BUDGET, and it is the same budget as the description's
 * (A6, 2026-09-02). A tool's `inputSchema` is PUSHED on every connection
 * exactly as its description is, and `dopl_channel`'s was **21,778 chars
 * served — 11.7× the 1,775 the T82 cap governs** — because 46 `.describe()`
 * blocks carried the RULE behind each field as well as its contract.
 *
 * ⚠ MEASURED AS **SERVED**, over a real `Client.listTools()`, and with the
 * registrar-injected `workspace` argument EXCLUDED: that one belongs to
 * `registrar.ts › WORKSPACE_ARG_SHAPE` and is a different slice's to shrink,
 * so counting it here would let this ratchet move on somebody else's edit.
 * ⚠ IT ONLY EVER MOVES DOWN. `channel-schema-budget.test.ts` fails both ways —
 * growing past it, and shrinking below it without lowering the number.
 */
// ⚠ 12,371 → 11,103 ON 2026-09-02 (A6b), and every character of it came from
// DELETING params rather than from shortening prose: `kind`, `intent`, `direct`
// and `to_desktop` are gone (C12/C5), `get_thread` left the `op` enum (C15),
// and ping's three recipient forms became one. A cut a re-worded sentence
// cannot make twice.
// ⚠ **11,103 → 11,341 ON 2026-09-02 (A14), AND THE 238 IS A KNOB RATHER THAN
// PROSE.** `response_format` joined the shape: `op="read"` and
// `op="read_sessions"` can now be asked for the smaller render, which drops the
// per-message timestamp and session tag and the thread-id legend from a page an
// orchestrator reads in a loop — and never a body. **That is a PARAMETER, on
// `dopl_skill`'s `confirm_token` precedent** (`tool-budget.test.ts ›
// SCHEMA_CEILINGS`): an argument cannot move into a pulled document, and
// trimming its description into uselessness would buy this number by making the
// knob unusable. ⚠ It is also the one rise on this surface that pays for itself
// PER CALL rather than per connection — 238 chars once, against a legend and two
// metadata fields on every message of every read.
exports.SCHEMA_MAX_CHARS = 11_341;
/**
 * ⚠ THE PER-FIELD HALF, AND IT IS THE ONE THAT ACTUALLY HOLDS THE LINE. A total
 * can absorb one 900-character paragraph by trimming nine short fields; this
 * cannot. A `.describe()` states the CONTRACT of one field — which ops take it,
 * what it is, its bound — in one sentence. The rule behind it belongs in
 * `channel-doctrine.ts › FIELDS`, which is PULLED by the agent that asks.
 */
exports.PARAM_DESCRIPTION_MAX_CHARS = 400;
const channel_doctrine_1 = require("./channel-doctrine");
const channel_await_budget_1 = require("./channel-await-budget");
exports.CHANNEL_INPUT_SHAPE = {
    // ⚠ ONE FIELD, TWO READ OPS ("read" and "read_sessions"), and its wording is
    // `response-size.ts`'s so the five tools that take this knob cannot promise
    // five different things about what `concise` drops. It is INERT on every
    // other op rather than refused: a knob that 400s where it is meaningless
    // teaches an agent to stop passing it where it is not.
    response_format: response_size_1.RESPONSE_FORMAT_FIELD,
    op: zod_1.z
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
        "read_sessions",
        "create_thread",
        // ⚠ TWO OPS LEFT THIS ENUM with thread closing (wiring plan Phase 4,
        // 2026-08-18): "propose_close" (the agent's terminal act) and
        // "close_thread" (kept as a teaching refusal naming its replacement).
        // Neither may come back as a WORD either — `channel-law.test.ts ›
        // REMOVED_VOCABULARY` scans every string literal in this file.
        "set_thread_mode",
        "direct_agent",
        "read_directions",
        "launch_agent",
        // ⚠ `end_agent` and `rename_agent` are NOT GATED BY THE LAUNCH TOGGLE and
        // no result may suggest otherwise: that setting governs STARTING agents.
        // `set_agent_mode` IS gated by it — a posture can cause compute to be
        // spent on the operator's hardware, which a stop verb and a label cannot.
        "end_agent",
        "rename_agent",
        "set_agent_mode",
        // ⚠ THE INFO CARD, AND ONLY THE INFO CARD (Samuel's ruling Q12 (b),
        // 2026-08-28). The same route accepts name / topic / archived, and this op
        // deliberately does not — see `channel-ops-update.ts`.
        "update",
        "escalate",
        "ping",
        "pings",
    ])
        .describe("Operation to perform."),
    // ⚠ **THE DOCTRINE IS PULLED, SO IT MUST BE PULLABLE IN PIECES** (2026-09-02).
    // `op="help"` returned the whole ~30k document or nothing, which makes the one
    // surface designed to be read on demand too expensive to read on demand — an
    // agent that wants the refusal vocabulary pays for the @-tag grammar as well.
    // The names come from `channel-doctrine.ts › DOCTRINE_SECTIONS`, so an unknown
    // one is a -32602 naming this field rather than a silently empty answer.
    section: zod_1.z
        .enum(channel_doctrine_1.DOCTRINE_SECTION_NAMES)
        .optional()
        .describe('op="help" (optional): return ONE section instead of the whole document. Omit it for everything, including the index of section names.'),
    channel: zod_1.z
        .string()
        .optional()
        .describe('Channel slug or id. Required except for "list", "open" and "pings"; on "read", "await" and "read_sessions" omitting it WIDENS the call to every channel you are in, across every workspace and home container.'),
    name: zod_1.z
        .string()
        .optional()
        .describe('op="open" (required for a NAMED channel; omit it and pass `member` instead to open a direct 1:1): the channel name, 1-120 chars. op="rename_agent" (required): a DISPLAY ONLY label for that agent — 1-60 visible characters on ONE line, or "" to clear it back to "Agent #<id>". `@agent-<id>` stays the only address, nothing resolves an agent by its name, and the label reaches no server.'),
    topic: zod_1.z
        .string()
        .optional()
        .describe('op="open": optional one-line topic / purpose for the channel.'),
    visibility: zod_1.z
        .enum(["private", "public"])
        .optional()
        .describe('op="open": "private" (default, invite-only) or "public" (any workspace member can see and join).'),
    member: zod_1.z
        .string()
        .optional()
        .describe('op="invite" (required) / op="open" (required for a direct 1:1, and only with `name` omitted): the member — an email or user id of an ACTIVE workspace member.'),
    body: zod_1.z
        .string()
        // ⚠ `.min(1)` mirrors the route on BOTH the post and create_thread schemas.
        .min(1)
        .max(16000)
        .optional()
        .describe('op="post" / op="create_thread" / op="milestone" (required): the message text. op="milestone": ONE LINE, <=240 chars and no line breaks, naming the step that just landed. op="ping" (required): ONE LINE, <=600 chars.'),
    to: zod_1.z
        .string()
        .optional()
        .describe('op="post" (optional) / op="create_thread" (required): the ONE channel MEMBER this is for — an email or user id. On a post it TRIGGERS that member\'s listener; omit it and the post is chat, which addresses nobody and starts nobody.'),
    // ⚠ One param, one route now. The declared 2000 is deliberately LOOSER than
    // the post route's 200 so an over-length summary is the route's to reject,
    // with the field named, rather than an opaque client-side -32602.
    summary: zod_1.z
        .string()
        .trim()
        .max(2000)
        .optional()
        .describe('op="post": a short one-line intent (<=200 chars). ALWAYS set it — it becomes the notification the receiving member sees.'),
    metadata: zod_1.z
        .record(zod_1.z.string(), zod_1.z.unknown())
        .optional()
        .describe('op="post": optional JSON object of structured fields carried with the message (e.g. {durationMs, refs}). Use `thread` for the thread id.'),
    // ⚠ ONE SENTENCE, BECAUSE THERE IS NOW ONE RULE (2026-09-02, C14). Both routes
    // dedupe PER-AUTHOR: `channel_messages` on
    // `(channel_id, client_msg_id, author_user_id)`
    // (`20260822120000_channel_messages_author_scoped_idempotency.sql`) and
    // `channel_tasks` on `(channel_id, client_msg_id, created_by)`
    // (`20260913120000_channel_tasks_author_scoped_idempotency.sql`). Until the
    // second landed this description had to teach the WEAKER of two keys — that a
    // peer's key hands you back THEIR thread — which is a documented way to be
    // silently redirected into somebody else's exchange.
    client_msg_id: zod_1.z
        .string()
        // ⚠ `.min(1)` mirrors the route — a blank idempotency key is not a key, and
        // a client-side refusal keeps the caller from believing it deduped anything.
        .min(1)
        .max(200)
        .optional()
        .describe('op="post" / op="create_thread" / op="launch_agent" / op="direct_agent" (optional): an idempotency key. Send one BEFORE you might need to retry — because a retried call with NO key starts a SECOND agent or writes a second row, while a re-sent key hands back YOUR first call\'s. The dedupe is PER-AUTHOR on every op: a key another member used is not yours and does not collide with it.'),
    title: zod_1.z
        .string()
        .trim()
        // ⚠ `.min(1)` mirrors the route and is measured AFTER the trim on both
        // sides, so a whitespace-only title is refused here rather than 400ing.
        .min(1)
        .max(200)
        .optional()
        .describe('op="create_thread" (required): the thread title, measured after trimming — a short header for the exchange, not a description. When the call is permitted to run, the bound is checked before anything goes on the wire.'),
    mode: zod_1.z
        .enum(["interactive", "autonomous"])
        .optional()
        .describe('op="create_thread" (optional, default "interactive") / op="set_thread_mode" (required): the thread execution mode.'),
    handoff: zod_1.z
        .boolean()
        .optional()
        .describe('op="create_thread" (optional, default false): true asks your operator\'s Dopl app to DRIVE this thread — a full session opens there and carries the conversation instead of this external one. Honoured only for a thread you created as yourself.'),
    thread: zod_1.z
        .string()
        .optional()
        .describe('The thread id create_thread returned. Required for op="set_thread_mode" and op="milestone". Optional on op="post" (thread it there), op="launch_agent" (start the agent on it), op="read" (its metadata header plus only that exchange) and op="ping" (point the signal at it).'),
    // ⚠ `agent_id`, NOT `agent`. `channel-addressing-rule.test.ts` bans a param
    // literally named `agent` — it was the retired named-agent ADDRESSING surface,
    // and "a param an MCP client can see is a param a model will try". This one
    // names an INSTANCE ID on the caller's own machine and addresses nobody in the
    // channel, which is exactly the distinction that guard exists to keep.
    // ⚠ A FOREIGN ID IS NOT REFUSED OUTRIGHT, AND THE SENTENCE NO LONGER SAYS SO
    // (G3 / F-418, 2026-09-02). `service-directions.ts` files the direction with
    // no ownership check; what answers is the CALLER'S OWN desktop, with
    // `no-session`. The honest claim is that nothing reaches the other machine.
    agent_id: zod_1.z
        .string()
        .optional()
        .describe('op="direct_agent" / "end_agent" / "rename_agent" / "set_agent_mode" (required) / "read_directions" (optional): WHICH of YOUR OWN operator\'s agents — the 8-character instance id, or the `@agent-<id>` handle read_sessions prints. There is no oldest-agent fallback. An id belonging to another member reaches nothing: the request goes to your own machine, which answers `no-session`.'),
    // ── op="ping" ────────────────────────────────────────────────────────────
    // 🔒 **ONE RECIPIENT PARAM, AND THAT IS THE LOOP BRAKE RESTATED AS A SHAPE**
    // (C5/F-429, 2026-09-02). It replaced THREE mutually exclusive spellings —
    // `to`, `to_desktop`, `agent_id` — which the handler had to COUNT at runtime
    // and refuse when it saw zero or two. A shape that can only carry one
    // recipient cannot be sent two, so the count and its two refusal sentences
    // are gone rather than reworded.
    // ⚠ **AND IT STILL NAMES NOBODY ELSE'S MACHINE.** `channel-ops-ping.ts ›
    // classifyRecipient` resolves this ONE string into the wire's own three keys,
    // and the only two self-scoped forms it can produce ("desktop", an agent
    // instance) resolve to the AUTHENTICATED CALLER server-side. There is still
    // no argument for whose machine, which is what `channel-ping.test.ts` pins.
    ping_kind: zod_1.z
        .enum(["done", "question", "blocked"])
        .optional()
        .describe('op="ping" (required): WHAT you are signalling — the work is "done", you have a "question" you need answered to continue, or you are "blocked" and not asking one.'),
    recipient: zod_1.z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('op="ping" (required): WHO has to act, in ONE field — "desktop" for your own operator\'s external session, `@agent-<id>` for one of your own operator\'s running agents, or an email / user id for another member of this channel.'),
    // ⚠ `outcome` ("completed" | "failed") was a param here, required by
    // op="propose_close" alone. It left with thread closing (wiring plan Phase 4,
    // 2026-08-18); nothing in this surface has an outcome any more.
    // ⚠ coerce: MCP clients sometimes send numbers as strings, and strict
    // z.number() rejects those with an opaque -32602.
    since: zod_1.z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .describe('op="read" (optional) / op="await" (always required): the last MESSAGE seq you have processed; only higher ones come back. A seq is TABLE-WIDE, which is what lets one cursor cover every channel. ⚠ A THREAD-SCOPED read offers NO cursor at all — take yours from an UNSCOPED read (drop `thread`).'),
    goal: zod_1.z
        .string()
        .trim()
        .min(1)
        .max(2000)
        .optional()
        .describe('op="launch_agent" (optional, but you almost always want it): what the agent should DO — it becomes that agent\'s opening instruction. Without one the agent starts with nothing to do and waits.'),
    model: zod_1.z
        .string()
        .trim()
        .min(1)
        .max(120)
        .optional()
        .describe('op="launch_agent" (optional): the model to run the agent on. Omit it for whatever the operator set for that channel. An id that machine does not recognize is NOT refused — it silently FALLS BACK, and nothing tells you.'),
    // ⚠ ID **OR** EXACT NAME, in ONE param — `dopl_kb`'s `base` already works this
    // way (`knowledge-shared.ts`), so this reuses the tree's idiom rather than
    // inventing a second convention. Bounded at 120, `agent_templates.name`'s own
    // cap, so a legal name is never refused client-side as an opaque -32602.
    template: zod_1.z
        .string()
        .trim()
        .min(1)
        .max(120)
        .optional()
        .describe('op="launch_agent" (optional): the AGENT TEMPLATE the new agent runs as — its id, or its exact name. It resolves in THIS CHANNEL\'S container under THE OPERATOR\'S visibility, and a name matching more than one is refused with every id listed. Omit it to start a blank agent.'),
    // ── ⚠ THE TWO PERMISSION AXES (2026-09-01, T24 + the re-posture verb) ───────
    //
    // ⚠ **THE ENUM MEMBERS ARE ORDERED NARROWEST FIRST AND THAT ORDER IS THE
    // CONTRACT.** The operator's machine clamps by INDEXING into a copy of these
    // sequences, so re-ordering either one silently inverts the bound.
    // ⚠ **ONE PARAM SERVES BOTH THE LAUNCH AND THE RE-POSTURE**, deliberately: it
    // is the same axis with the same four values and the same clamp, and two names
    // for one thing is how a caller learns to guess which one an op wants.
    tools: zod_1.z
        .enum(["manual", "accept_edits", "auto", "bypass"])
        .optional()
        .describe('op="launch_agent" / op="set_agent_mode" (optional): how much TOOL freedom to ASK FOR — the values are ordered narrowest first. Your operator\'s machine narrows whatever you ask for to their own ceiling and never widens past it; omit it to run at that setting.'),
    messages: zod_1.z
        .enum(["ask", "auto_inbound", "auto_outbound", "auto_both"])
        .optional()
        .describe('op="launch_agent" / op="set_agent_mode" (optional): how much MESSAGE freedom to ASK FOR — the values are ordered narrowest first. Clamped to your operator\'s ceiling exactly as `tools` is, and held to a floor for a session with no window.'),
    // ⚠ **THREE VALUES BECAUSE THERE ARE THREE STATES** (C11, 2026-09-02). It was
    // an optional boolean whose `.describe()` had to spend a paragraph saying that
    // omitting it was NOT `false` — and that exact confusion was a live wire bug
    // (GAP C: `directiveFrom` flattened `false` to `null`). `inherit` is now a
    // VALUE a caller can send, so "absent" and "off" can never be conflated again
    // by anything downstream. `channel-dispatch-agents.ts` maps the word back to
    // the wire's `boolean | undefined`, which did not move.
    chain: zod_1.z
        .enum(["inherit", "on", "off"])
        .optional()
        .describe('op="launch_agent" (optional, default "inherit"): may the new agent launch further agents? "inherit" takes your operator\'s channel setting, which may be ON; "off" always narrows; "on" is REFUSED rather than quietly narrowed when the channel forbids it.'),
    wait_ms: zod_1.z.coerce
        .number()
        .int()
        .min(0)
        .max(30_000)
        .optional()
        .describe('op="launch_agent" / "end_agent" / "rename_agent" / "set_agent_mode" (optional, default 15000): how long to hold for the operator\'s desktop to accept or refuse. A timeout is NOT a failure — the request stays PENDING, and a re-issue is safe only when it carries the same `client_msg_id`.'),
    info_card: zod_1.z
        .object({
        hidden: zod_1.z
            .array(zod_1.z.string())
            .max(3)
            .optional()
            .describe('Built-in rows to HIDE, by key: "email", "created", "lastActivity".'),
        rows: zod_1.z
            .array(zod_1.z.object({
            id: zod_1.z
                .string()
                .max(64)
                .optional()
                .describe("Omit on a NEW row (one is minted for you); pass it to EDIT the row that already has it. Unique within a card."),
            label: zod_1.z.string().min(1).max(40).describe("The left column — one short line."),
            value: zod_1.z.string().max(200).optional().describe("The right column. May be empty."),
        }))
            .max(12)
            .optional()
            .describe("The card's CUSTOM rows, at most 12."),
    })
        .optional()
        .describe('op="update": the channel\'s whole info card, REPLACED — an omitted row is DELETED and `info_card={}` clears the card. Omit the argument entirely to READ the card unchanged. Everyone in the channel sees it.'),
    // ── op="escalate" ────────────────────────────────────────────────────────
    // ⚠ FOUR SEPARATE PARAMS RATHER THAN ONE `escalation` OBJECT, deliberately.
    // The whole point of the op is that an agent has to SAY the four things; a
    // nested object lets a model fill one key with a paragraph and satisfy the
    // schema. Caps mirror `src/features/channels/escalation.ts` — sync all three
    // (that file, this one, `channel-errors.ts › FIELD_CAPS_NOTE`).
    issue: zod_1.z
        .string()
        .trim()
        .min(1)
        .max(200)
        .optional()
        .describe('op="escalate" (required): the decision you cannot make, in ONE line. It becomes the card\'s title.'),
    context: zod_1.z
        .string()
        .trim()
        .max(2000)
        .optional()
        .describe('op="escalate" (optional): what a person needs to know to choose, and nothing else. Do not restate the options — they carry their own consequences.'),
    options: zod_1.z
        .array(zod_1.z.object({
        label: zod_1.z
            .string()
            .trim()
            .min(1)
            .max(80)
            .describe("The button's face — one short imperative, <=80 chars."),
        consequence: zod_1.z
            .string()
            .trim()
            .min(1)
            .max(200)
            .describe("ONE line saying what happens if they press it (<=200 chars). Required on every option."),
    }))
        .min(2)
        .max(6)
        .optional()
        .describe('op="escalate" (required): 2-6 things a person could decide. BOTH BOUNDS ARE REAL — one option is not a question, and more than six is a wall of prose with numbers on it.'),
    recommendation: zod_1.z
        .object({
        index: zod_1.z
            .number()
            .int()
            .min(0)
            .describe("0-based index into `options` — the one you would take."),
        why: zod_1.z
            .string()
            .trim()
            .min(1)
            .max(200)
            .describe("ONE line for why (<=200 chars)."),
    })
        .optional()
        .describe('op="escalate" (optional but almost always right): which option you would take and why. `index` MUST be inside `options` — an out-of-range one refuses the whole call.'),
    limit: zod_1.z.coerce
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe('op="read": max messages to return (default 100) — with no `since` that is the NEWEST 100, and older ones are absent rather than reported. op="pings": max pings (1-100, default 20) — the newest first.'),
    timeout_ms: zod_1.z.coerce
        .number()
        .int()
        .min(0)
        .max(channel_await_budget_1.AWAIT_HOLD_CAP_MS)
        .optional()
        .describe(`op="await" (optional): TOTAL time to hold before returning with no messages, in ms. Omitted, the default fits your client: ${channel_await_budget_1.AWAIT_HOLD_EXTERNAL_DEFAULT_MS} external, ${channel_await_budget_1.AWAIT_HOLD_DEFAULT_MS} for a session run by the Dopl desktop.`),
};
