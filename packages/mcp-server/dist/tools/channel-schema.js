"use strict";
/**
 * THE PUBLISHED INPUT SHAPE for `dopl_channel` — one flat schema of optional
 * params, plus the `op` discriminator and the `action` sub-verb the two
 * dispatching ops take, with the per-op requirements enforced at runtime by
 * `missingParams` in the registrar.
 *
 * This is the DECLARED SURFACE an MCP client introspects (names, types, caps,
 * per-param teaching); the registrar is routing. ⚠ The parity suite reads both:
 * every declared param must be referenced by some handler in the `channel-*`
 * group, and no handler may read an arg not declared here.
 *
 * ⚠ **FIVE OPS SINCE 2026-09-02 (MCP v2 wave B slice B8, Samuel's ruling B9).**
 * `send` · `read` · `status` · `manage` · `rooms`, down from twenty-three. The
 * other twenty-two names still PARSE for one release and answer one line naming
 * their replacement (`channel-retired-ops.ts`) — and they are **absent from the
 * published enum**, because a retired name a model can see is a name a model
 * will call. The runtime enum is the union; `.meta({ enum: CHANNEL_OPS })`
 * overrides what `z.toJSONSchema` publishes, which is the exact conversion the
 * MCP SDK renders for `tools/list`.
 *
 * ⚠ **EVERY `.describe()` HERE IS PUSHED ON EVERY CONNECTION, EXACTLY LIKE THE
 * TOOL DESCRIPTION, AND IS BUDGETED LIKE ONE** (A6, 2026-09-02). It was 20,844
 * characters over 46 blocks — 11.7× the description the T82 cap governs — because
 * each block carried the RULE behind its field as well as its contract. A rule
 * belongs in `channel-doctrine.ts`, which is PULLED by the agent that asks for
 * it; a `.describe()` carries the CONTRACT of one field and stops. One sentence
 * each, and `channel-schema-budget.test.ts` is what keeps it there.
 *
 * ⚠ **NO `.describe()` HAND-TYPES A BOUND THE SCHEMA PUBLISHES.** A cap reaches
 * the client as a `maxLength` / `maximum` keyword and once more in the
 * description's rendered `Limits:` block (`tool-style.ts › renderLimits`); a
 * third copy in the prose is the copy that goes stale, and `tool-style.test.ts`
 * fails one.
 *
 * ⚠ Caps and minimums HAND-MIRROR the routes' zod schemas
 * (src/features/channels/schema.ts): body 16000, summary 200, client_msg_id
 * 200, `.min(1)` on body / client_msg_id. Declared here they publish as
 * maxLength and are enforced before the call; omit one and the route rejects it
 * as an opaque 400 the write ops mis-narrate. `.trim()` where — and ONLY where —
 * the route trims before measuring, so the two agree on what a character count
 * counts.
 *
 * ⚠ **`summary` IS ONE NUMBER NOW (200), AND THAT IS A RULING** (Samuel, wave B).
 * It declared the LOOSER 2000 so an over-length summary would be the route's to
 * refuse with the field named; the route enforces 200, so the schema published a
 * cap the surface does not have. One field, one bound, both ends.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHANNEL_INPUT_SHAPE = exports.PARAM_DESCRIPTION_MAX_CHARS = exports.SCHEMA_MAX_CHARS = exports.CHANNEL_ACTION_NAMES = exports.CHANNEL_ACTIONS = exports.CHANNEL_OPS = void 0;
const zod_1 = require("zod");
const response_size_1 = require("./response-size");
const channel_retired_ops_1 = require("./channel-retired-ops");
const channel_doctrine_1 = require("./channel-doctrine");
const channel_await_budget_1 = require("./channel-await-budget");
/**
 * THE FIVE OPS AN AGENT SEES, and the only five it may pick from.
 *
 * ⚠ THE ORDER IS THE READING ORDER a model skims: the one write it makes most,
 * the two reads, then the two dispatchers.
 */
exports.CHANNEL_OPS = [
    "send",
    "read",
    "status",
    "manage",
    "rooms",
];
/**
 * THE SUB-VERBS, per dispatching op.
 *
 * ⚠ **THE TWO VOCABULARIES ARE DISJOINT BY CONSTRUCTION**, and a test asserts
 * it: one flat `action` enum is what a client introspects, so an overlapping
 * word would make the same string mean two things one op apart. Disjointness is
 * also what lets `gating.ts › WRITE_OPS` name a single write action
 * (`rooms.open`) without the pair ever being ambiguous.
 *
 * ⚠ **`rooms` CARRIES BOTH READS AND WRITES, AND THAT IS WHY THE WRITE GATE IS
 * PER-ACTION.** Classifying the whole op as a write would refuse a read-only
 * token the very calls it exists to make — `list`, `members`, `help` — and
 * classifying it as a read would open `open` / `invite` / `update` to one.
 */
exports.CHANNEL_ACTIONS = {
    manage: ["launch", "end", "rename", "posture", "direct"],
    rooms: [
        "list",
        "open",
        "invite",
        "members",
        "threads",
        "thread_mode",
        "update",
        "help",
    ],
};
/** Every action name, as the published enum. ⚠ Derived, never restated. */
exports.CHANNEL_ACTION_NAMES = [
    ...exports.CHANNEL_ACTIONS.manage,
    ...exports.CHANNEL_ACTIONS.rooms,
];
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
// ⚠ 11,341 → 3,061 ON 2026-09-02 (B8), AND EVERY CHARACTER OF IT CAME FROM
// DELETING PARAMS AND OPS RATHER THAN FROM SHORTENING PROSE. Thirteen params
// left the shape — `topic`, `member`, `title`, `handoff`, `agent_id`,
// `ping_kind`, `recipient`, `metadata`, `goal`, `issue`, `context`,
// `timeout_ms`, and the three posture axes, which became one `posture` object —
// because the concept each named already had a field: a recipient is `to`, an
// intent is `summary`, a goal is `body`, a hold is `wait_ms`. Eighteen op names
// left the published enum. A cut a re-worded sentence cannot make twice.
exports.SCHEMA_MAX_CHARS = 3_061;
/**
 * ⚠ THE PER-FIELD HALF, AND IT IS THE ONE THAT ACTUALLY HOLDS THE LINE. A total
 * can absorb one 900-character paragraph by trimming nine short fields; this
 * cannot. A `.describe()` states the CONTRACT of one field — which ops take it,
 * what it is, its bound — in one sentence. The rule behind it belongs in
 * `channel-doctrine.ts › FIELDS`, which is PULLED by the agent that asks.
 */
exports.PARAM_DESCRIPTION_MAX_CHARS = 400;
exports.CHANNEL_INPUT_SHAPE = {
    // ⚠ ONE FIELD, TWO READ OPS ("read" and "status"), and its wording is
    // `response-size.ts`'s so the five tools that take this knob cannot promise
    // five different things about what `concise` drops. It is INERT on every
    // other op rather than refused: a knob that 400s where it is meaningless
    // teaches an agent to stop passing it where it is not.
    response_format: response_size_1.RESPONSE_FORMAT_FIELD,
    // ⚠ **THE RUNTIME ENUM IS THE UNION; THE PUBLISHED ONE IS FIVE.** The retired
    // names have to PARSE or their redirect can never run — zod would answer a
    // `-32602 invalid enum value` before any handler sees the call, which is the
    // opaque failure the one-release window exists to prevent. They must not be
    // LISTED, or the collapse buys nothing: a model picks from what it is shown.
    // `.meta()` overrides the `enum` keyword `z.toJSONSchema` emits, and that is
    // the exact conversion `@modelcontextprotocol/sdk › toJsonSchemaCompat` runs
    // for `tools/list`; `channel-retired-ops.test.ts` asserts both halves.
    op: zod_1.z
        .enum([...exports.CHANNEL_OPS, ...channel_retired_ops_1.RETIRED_OP_NAMES])
        .meta({ enum: [...exports.CHANNEL_OPS] })
        .describe("Operation to perform."),
    // ⚠ ONE SUB-VERB PARAM FOR BOTH DISPATCHERS, not two. The vocabularies are
    // disjoint, so one field can never be ambiguous — and two spellings for "which
    // act" is how a caller learns to guess which one an op wants.
    action: zod_1.z
        .enum(exports.CHANNEL_ACTION_NAMES)
        .optional()
        .describe('op="manage" (required): "launch", "end", "rename", "posture" or "direct" — all on YOUR OWN operator\'s machine. op="rooms" (required): "list", "open", "invite", "members", "threads", "thread_mode", "update" or "help".'),
    channel: zod_1.z
        .string()
        .optional()
        .describe('Channel slug or id. Required everywhere except op="rooms" action="list" / "open" / "help"; on op="read" and op="status" omitting it WIDENS the call to every channel you are in, across every workspace and home container.'),
    // ⚠ **ONE RECIPIENT PARAM FOR THE WHOLE SURFACE** (B8). It replaced `to`,
    // `member`, `recipient` and `agent_id` — four spellings of "the one party this
    // call is about", each with its own resolution story. The server resolves the
    // union once, at the door (`service-writes-metadata-recipient.ts ›
    // resolveToRecipient`), and an `@name` that resolves to NOBODY is a 400
    // listing the live handles rather than a silent `delivery=none`.
    to: zod_1.z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('The ONE party this call is about — a member (email or user id) or an agent (`@agent-<id>` or its handle). op="send": who it is FOR, which triggers their side; op="manage": which of your own operator\'s agents; op="rooms": the member to "invite", or the one to open a 1:1 with.'),
    body: zod_1.z
        .string()
        .min(1)
        .max(16000)
        .optional()
        .describe('op="send" (required): the message text — ONE LINE naming the step that just landed on kind="milestone", and what a person needs to know to choose on kind="decision". op="manage" (required on action="launch" and action="direct"): the agent\'s opening instruction, or the private message.'),
    // ⚠ THREE VALUES, EACH WITH A FENCE (spec §2.1). `milestone` stores
    // `task_progress` and keeps G14's one-line cap; `decision` stores `message`
    // plus the validated escalation payload, and it MUST stay `message` or
    // `targeting.js › classify` drops the card and the human it asks is never
    // notified. ⚠ `question` / `blocked` / `done` are NOT adopted: a value with no
    // distinct behaviour is prose wearing a schema.
    kind: zod_1.z
        .enum(["message", "milestone", "decision"])
        .optional()
        .describe('op="send" (optional, default "message"): "milestone" marks a step on a thread and addresses nobody; "decision" posts a card a person answers with one press, and needs `summary`, `options` and — almost always — `recommendation`.'),
    thread: zod_1.z
        .string()
        .optional()
        .describe('A thread id, or the legacy `task-<channel>-<seq>` label. ⚠ "new" on op="send" OPENS one and returns its id, with `summary` as its title. Required on op="send" kind="milestone" and on op="rooms" action="thread_mode"; optional on op="read" and op="manage".'),
    summary: zod_1.z
        .string()
        .trim()
        .max(200)
        .optional()
        .describe('The one-line intent. ALWAYS set it on op="send" — it becomes the notification the receiving member sees; on thread="new" it is the thread TITLE, on kind="decision" it is the QUESTION the card asks, and on op="rooms" action="open" it is the channel topic.'),
    // ⚠ ONE SENTENCE, BECAUSE THERE IS NOW ONE RULE (2026-09-02, C14). Both routes
    // dedupe PER-AUTHOR: `channel_messages` on
    // `(channel_id, client_msg_id, author_user_id)` and `channel_tasks` on
    // `(channel_id, client_msg_id, created_by)`. Until the second landed this
    // description had to teach the WEAKER of two keys — that a peer's key hands
    // you back THEIR thread — which is a documented way to be silently redirected
    // into somebody else's exchange.
    client_msg_id: zod_1.z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe('op="send" / op="manage" (optional): an idempotency key. Send one BEFORE you might need to retry — a retried call with NO key starts a SECOND agent or writes a second row, while a re-sent key hands back YOUR first call\'s. The dedupe is PER-AUTHOR on every op.'),
    // ── kind="decision" ──────────────────────────────────────────────────────
    // ⚠ TWO SEPARATE PARAMS RATHER THAN ONE `escalation` OBJECT, deliberately.
    // The whole point of the kind is that an agent has to SAY these things; a
    // nested object lets a model fill one key with a paragraph and satisfy the
    // schema. The other two fields it used to need are gone because the surface
    // already had them: the ISSUE is `summary`, the CONTEXT is `body`. Caps mirror
    // `src/features/channels/escalation.ts` — sync all three (that file, this one,
    // `channel-errors.ts › FIELD_CAPS_NOTE`).
    options: zod_1.z
        .array(zod_1.z.object({
        label: zod_1.z
            .string()
            .trim()
            .min(1)
            .max(80)
            .describe("The button's face — one short imperative."),
        consequence: zod_1.z
            .string()
            .trim()
            .min(1)
            .max(200)
            .describe("ONE line saying what happens if they press it. Required on every option."),
    }))
        .min(2)
        .max(6)
        .optional()
        .describe('op="send" with kind="decision" (required): 2-6 things a person could decide. BOTH BOUNDS ARE REAL — one option is not a question, and more than six is a wall of prose with numbers on it.'),
    recommendation: zod_1.z
        .object({
        index: zod_1.z
            .number()
            .int()
            .min(0)
            .describe("0-based index into `options` — the one you would take."),
        why: zod_1.z.string().trim().min(1).max(200).describe("ONE line for why."),
    })
        .optional()
        .describe('op="send" with kind="decision" (optional but almost always right): which option you would take and why. `index` MUST be inside `options` — an out-of-range one refuses the whole call.'),
    // ── op="read" ────────────────────────────────────────────────────────────
    // ⚠ coerce: MCP clients sometimes send numbers as strings, and strict
    // z.number() rejects those with an opaque -32602.
    since: zod_1.z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .describe('op="read" (optional, and REQUIRED with `wait_ms`): the last MESSAGE seq you have processed; only higher ones come back. A seq is TABLE-WIDE, which is what lets one cursor cover every channel. ⚠ A THREAD-SCOPED read offers NO cursor at all — take yours from an UNSCOPED read (drop `thread`).'),
    limit: zod_1.z.coerce
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe('op="read" (optional): max messages to return — with no `since` that is the NEWEST page, and older ones are absent rather than reported.'),
    // ⚠ **ONE HOLD PARAM, TWO LANES, AND THEY ARE THE SAME QUESTION.** `wait_ms`
    // asked the operator's desktop to answer a directive; `timeout_ms` asked the
    // server to hold for a message. Both are "how long may this call take before
    // it comes back with nothing", both cap server-side, and two names for one
    // knob is how a caller learns to guess. ⚠ The published cap is the HOLD's
    // (`AWAIT_HOLD_CAP_MS`); the directive lane clamps to its own, which it has
    // always done in code (`channel-ops-launch.ts › WAIT_CAP_MS`).
    wait_ms: zod_1.z.coerce
        .number()
        .int()
        .min(0)
        .max(channel_await_budget_1.AWAIT_HOLD_CAP_MS)
        .optional()
        .describe('Optional HOLD. op="read": long-poll for messages after `since` instead of returning a page. op="manage": how long to hold for your operator\'s desktop to accept or refuse — a timeout is NOT a failure, the request stays PENDING, and a re-issue is safe only when it carries the same `client_msg_id`.'),
    // ── op="rooms" ───────────────────────────────────────────────────────────
    // ⚠ `name` SERVES TWO ACTIONS AND THEY ARE BOTH LABELS, which is why one field
    // can carry them: a channel's name and an agent's display label are the same
    // kind of thing — a string people read. Neither addresses anything.
    name: zod_1.z
        .string()
        .optional()
        .describe('op="rooms" action="open" (required for a NAMED channel; omit it and pass `to` instead to open a direct 1:1): the channel name. op="manage" action="rename" (required): a DISPLAY ONLY label for that agent on ONE line, or "" to clear it — `@agent-<id>` stays the only address, nothing resolves an agent by its name, and the label reaches no server.'),
    visibility: zod_1.z
        .enum(["private", "public"])
        .optional()
        .describe('op="rooms" action="open" (optional): "private" (default, invite-only) or "public" (any workspace member can see and join).'),
    mode: zod_1.z
        .enum(["interactive", "autonomous"])
        .optional()
        .describe('op="rooms" action="thread_mode" (required): the thread execution mode.'),
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
            label: zod_1.z
                .string()
                .min(1)
                .max(40)
                .describe("The left column — one short line."),
            value: zod_1.z
                .string()
                .max(200)
                .optional()
                .describe("The right column. May be empty."),
        }))
            .max(12)
            .optional()
            .describe("The card's CUSTOM rows."),
    })
        .optional()
        .describe('op="rooms" action="update": the channel\'s whole info card, REPLACED — an omitted row is DELETED and `info_card={}` clears the card. Omit the argument entirely to READ the card unchanged. Everyone in the channel sees it.'),
    // ⚠ **THE DOCTRINE IS PULLED, SO IT MUST BE PULLABLE IN PIECES** (2026-09-02).
    // Help returned the whole document or nothing, which makes the one surface
    // designed to be read on demand too expensive to read on demand. The names
    // come from `channel-doctrine.ts › DOCTRINE_SECTIONS`, so an unknown one is a
    // -32602 naming this field rather than a silently empty answer.
    section: zod_1.z
        .enum(channel_doctrine_1.DOCTRINE_SECTION_NAMES)
        .optional()
        .describe('op="rooms" action="help" (optional): return ONE section instead of the whole document. Omit it for everything, including the index of section names.'),
    // ── op="manage" action="launch" ──────────────────────────────────────────
    model: zod_1.z
        .string()
        .trim()
        .min(1)
        .max(120)
        .optional()
        .describe('op="manage" action="launch" (optional): the model to run the agent on. Omit it for whatever the operator set for that channel. An id that machine does not recognize is NOT refused — it silently FALLS BACK, and nothing tells you.'),
    // ⚠ ID **OR** EXACT NAME, in ONE param — `dopl_kb`'s `base` already works this
    // way (`knowledge-shared.ts`), so this reuses the tree's idiom rather than
    // inventing a second convention.
    template: zod_1.z
        .string()
        .trim()
        .min(1)
        .max(120)
        .optional()
        .describe('op="manage" action="launch" (optional): the AGENT TEMPLATE the new agent runs as — its id, or its exact name. It resolves in THIS CHANNEL\'S container under THE OPERATOR\'S visibility, and a name matching more than one is refused with every id listed. Omit it to start a blank agent.'),
    // ── ⚠ THE PERMISSION AXES, IN ONE OBJECT (B8; 2026-09-01's T24 axes) ───────
    //
    // ⚠ **ONE PARAM BECAUSE THE CODE ALREADY TREATS THEM AS ONE THING** —
    // `channel-facts.ts › postureFacts` renders the trio together, the desktop
    // clamps them together, and `action="posture"` exists to set them together.
    // Three top-level params for one concept is what made this shape 35 fields.
    // ⚠ **THE ENUM MEMBERS ARE ORDERED NARROWEST FIRST AND THAT ORDER IS THE
    // CONTRACT.** The operator's machine clamps by INDEXING into a copy of these
    // sequences, so re-ordering either one silently inverts the bound.
    // ⚠ **`chain` HAS THREE VALUES BECAUSE THERE ARE THREE STATES** (C11): it was
    // an optional boolean whose describe had to spend a paragraph saying that
    // omitting it was NOT `false`, and that exact confusion was a live wire bug
    // (GAP C: `directiveFrom` flattened `false` to `null`).
    posture: zod_1.z
        .object({
        tools: zod_1.z
            .enum(["manual", "accept_edits", "auto", "bypass"])
            .optional()
            .describe("How much TOOL freedom to ask for — values ordered narrowest first."),
        messages: zod_1.z
            .enum(["ask", "auto_inbound", "auto_outbound", "auto_both"])
            .optional()
            .describe("How much MESSAGE freedom to ask for — narrowest first, and held to a floor for a session with no window."),
        chain: zod_1.z
            .enum(["inherit", "on", "off"])
            .optional()
            .describe('May the new agent launch further agents? "inherit" takes your operator\'s channel setting, which may be ON; "off" always narrows; "on" is REFUSED rather than quietly narrowed when the channel forbids it. Launch only.'),
    })
        .optional()
        .describe('op="manage" action="launch" / action="posture" (optional): how much freedom to ASK FOR. Your operator\'s machine narrows whatever you ask for to their own ceiling and never widens past it; omit an axis to run at that setting.'),
};
