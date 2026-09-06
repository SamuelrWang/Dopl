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
 * ⚠ **FIVE OPS SINCE 2026-09-02 (MCP v2 wave B slice B8, Samuel's ruling B9),
 * AND FIVE AT RUNTIME TOO SINCE SLICE B16.** `send` · `read` · `status` ·
 * `manage` · `rooms`, down from twenty-three. The other twenty-two names parsed
 * for one release and answered a one-line redirect; that window is CLOSED, so
 * the runtime enum and the published one are the same five and a retired name is
 * refused by schema validation with {@link unknownOpRefusal}'s line. The names
 * are kept as dead vocabulary in `law-removed-vocabulary.ts ›
 * RETIRED_CHANNEL_OPS`, which is what stops a shipped string teaching one.
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
exports.unknownOpRefusal = unknownOpRefusal;
exports.unknownActionRefusal = unknownActionRefusal;
const zod_1 = require("zod");
const response_size_1 = require("./response-size");
const channel_doctrine_1 = require("./channel-doctrine");
const channel_hold_budget_1 = require("./channel-hold-budget");
/**
 * THE SIX OPS AN AGENT SEES, and the only six it may pick from.
 *
 * ⚠ THE ORDER IS THE READING ORDER a model skims: the one write it makes most,
 * the two reads, then the three dispatchers.
 *
 * ⚠ **`artifact` IS THE SIXTH, ADDED 2026-09-06 (design #1220 §5, accepted at
 * #1222), AND IT IS AN OP RATHER THAN A `send` KIND** — it writes no message. It
 * folds messages that ALREADY EXIST into one card, which is a different verb on
 * a different row, and hanging it off the send lane would have put a
 * non-delivery on the one op whose whole contract is that it delivers.
 */
exports.CHANNEL_OPS = [
    "send",
    "read",
    "status",
    "manage",
    "rooms",
    "artifact",
];
/**
 * THE ONE REFUSAL FOR A WORD THAT IS NOT AN OP, written once and used twice
 * (slice B16): the schema's own zod error, and `channel.ts`'s exhaustive
 * `default` for a build where that validation did not run.
 *
 * ⚠ **WITHOUT IT, RETIREMENT IS A `-32602 invalid enum value`** — the opaque
 * failure B8's one-release redirect window existed to prevent, arriving one
 * release later. ⚠ **ONE LINE, AND IT NAMES THE WHOLE VOCABULARY** — six words
 * since `artifact` landed (A4, 2026-09-06), derived from {@link CHANNEL_OPS} and
 * never counted here; anything longer is `rooms(action="help")`'s doctrine.
 *
 * ⚠ The caller's own word is echoed BOUNDED AND ON ONE LINE — it is the only
 * part of this sentence they wrote, and an unbounded multi-line echo is
 * structure a caller can forge inside our narration.
 */
function unknownOpRefusal(op) {
    const raw = typeof op === "string" ? op : (JSON.stringify(op) ?? String(op));
    const shown = raw.replace(/\s+/g, " ").slice(0, 40);
    // ⚠ Same sentence shape as the two `action` refusals in `channel.ts` — one
    // vocabulary, listed and then joined with "or", derived from the enum so a
    // sixth op cannot arrive without appearing here.
    const quoted = exports.CHANNEL_OPS.map((o) => `"${o}"`);
    const offered = `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
    return `dopl_channel has no op "${shown}" — it takes ${offered}. Nothing was done.`;
}
/**
 * THE SUB-VERBS, per dispatching op.
 *
 * ⚠ **THE THREE VOCABULARIES ARE DISJOINT BY CONSTRUCTION**, and a test asserts
 * it: one flat `action` enum is what a client introspects, so an overlapping
 * word would make the same string mean two things one op apart. Disjointness is
 * also what lets `gating.ts › WRITE_OPS` name a single write action
 * (`rooms.open`) without the pair ever being ambiguous.
 *
 * ⚠ **THE THIRD LIST ARRIVED WITH `artifact` (2026-09-06) AND THE DISJOINTNESS
 * RULE IS WHY ITS WORDS ARE WHAT THEY ARE.** `create` was the obvious name for
 * opening a room too, and `open` for a card; both were rejected here rather than
 * disambiguated later, because the pairing refusals below can only say "that
 * word belongs to <op>" while every word belongs to exactly one.
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
    // ⚠ FOUR ACTS, AND `dissolve` IS NOT A DELETE — it clears the column from
    // every member and retires the card, leaving every body, author and `seq`
    // exactly where it was. That is what keeps a fold reversible, and it is why
    // this op sits inside the tool's published "no delete op" policy.
    artifact: ["create", "add", "remove", "dissolve"],
};
/** Every action name, as the published enum. ⚠ Derived, never restated. */
exports.CHANNEL_ACTION_NAMES = [
    ...exports.CHANNEL_ACTIONS.manage,
    ...exports.CHANNEL_ACTIONS.rooms,
    ...exports.CHANNEL_ACTIONS.artifact,
];
/**
 * THE ONE REFUSAL FOR A WORD THAT BELONGS TO ANOTHER OP — written once here,
 * used by all three dispatch arms in `channel.ts`.
 *
 * ⚠ **IT WAS TWO HAND-WRITTEN SENTENCES UNTIL 2026-09-06, AND THE THIRD
 * VOCABULARY IS WHY IT IS DERIVED NOW.** Each arm said "that word belongs to"
 * and then NAMED the other op, which is a claim only true while there are
 * exactly two lists: the moment `artifact` arrived, `manage(action="create")`
 * would have told the caller to try `rooms`, confidently and wrongly. The owner
 * is looked up in the same table the enum is built from, so a fourth
 * vocabulary cannot make this sentence lie.
 *
 * ⚠ The offered list is the op's OWN vocabulary, joined with "or" — the same
 * shape as {@link unknownOpRefusal}, and the one thing a caller cannot read off
 * a flat `action` enum that publishes all three lists as one.
 */
function unknownActionRefusal(op, action) {
    const shown = action.replace(/\s+/g, " ").slice(0, 40);
    const owner = Object.keys(exports.CHANNEL_ACTIONS).find((candidate) => candidate !== op &&
        exports.CHANNEL_ACTIONS[candidate].includes(action));
    // ⚠ THE OWNER CLAUSE IS OMITTED RATHER THAN GUESSED when no vocabulary has
    // the word. Unreachable through the published schema — `action` is an enum
    // over all three lists — and kept for the same reason `channel.ts` keeps its
    // exhaustive default: a build where that validation did not run must refuse,
    // and must not invent an op to send the caller to.
    const belongs = owner ? ` — that word belongs to op="${owner}"` : "";
    const quoted = exports.CHANNEL_ACTIONS[op].map((a) => `"${a}"`);
    const offered = `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
    return `op="${op}" has no action "${shown}"${belongs}. Nothing was done. op="${op}" takes ${offered}.`;
}
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
// ⚠ 11,341 → 8,410 ON 2026-09-02 (B8), AND EVERY CHARACTER OF IT CAME FROM
// DELETING PARAMS AND OPS RATHER THAN FROM SHORTENING PROSE. Thirteen params
// left the shape — `topic`, `member`, `title`, `handoff`, `agent_id`,
// `ping_kind`, `recipient`, `metadata`, `goal`, `issue`, `context`,
// `timeout_ms`, and the three posture axes, which became one `posture` object —
// because the concept each named already had a field: a recipient is `to`, an
// intent is `summary`, a goal is `body`, a hold is `wait_ms`. Eighteen op names
// left the published enum. A cut a re-worded sentence cannot make twice.
exports.SCHEMA_MAX_CHARS = 8_405; // ⚠ 8,410 → 8,405 ON 2026-09-03: `section=`'s enum gained `waiting` (the hold-not-poll doctrine is unreachable without a name to pull it by) and that field's own `.describe()` more than paid for it. It still only ever moves DOWN.
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
    // ⚠ **ONE ENUM NOW — THE RUNTIME SET AND THE PUBLISHED SET ARE THE SAME FIVE**
    // (slice B16). They were deliberately different for one release: the twenty-two
    // retired names had to PARSE so their redirect could run, and had to be absent
    // from the JSON Schema so no model could see one. Both halves retire together —
    // a hidden name that no longer answers anything is a name that only ever
    // produces a confusing success. What replaces the redirect is the REFUSAL:
    // zod's own error carries {@link unknownOpRefusal}, so a caller pinned to an
    // older desktop still reads one line naming the five instead of an opaque
    // `-32602 invalid enum value`.
    op: zod_1.z
        .enum(exports.CHANNEL_OPS, { error: (issue) => unknownOpRefusal(issue.input) })
        .describe("Operation to perform."),
    // ⚠ ONE SUB-VERB PARAM FOR BOTH DISPATCHERS, not two. The vocabularies are
    // disjoint, so one field can never be ambiguous — and two spellings for "which
    // act" is how a caller learns to guess which one an op wants.
    action: zod_1.z
        .enum(exports.CHANNEL_ACTION_NAMES)
        .optional()
        .describe('op="manage" (required): "launch", "end", "rename", "posture" or "direct" — all on YOUR OWN operator\'s machine. op="rooms" (required): "list", "open", "invite", "members", "threads", "thread_mode", "update" or "help". op="artifact" (required): "create", "add", "remove" or "dissolve".'),
    channel: zod_1.z
        .string()
        .optional()
        .describe(
    // ⚠ THE WIDER-READ RULE IS THE DOCTRINE'S (`FIELDS › OMITTING \`channel\`
    // IS A WIDER READ`), which states the scope this sentence used to repeat —
    // every channel you are in, across every workspace and home container.
    // What stays is the CONTRACT: which calls require it, and what omitting it
    // does. `channel-schema-budget.test.ts` pins the doctrine line, so the fact
    // is relocated rather than dropped.
    'Channel slug or id. Required except on op="rooms" action="list" / "open" / "help"; omitting it WIDENS op="read" and op="status".'),
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
        .describe(
    // ⚠ "which triggers their side" IS THE LAW'S SENTENCE, not this field's:
    // `CHANNEL_LAW` states that addressing a person asks for their machine and
    // that THEIR side decides what runs. The per-op meanings stay, because they
    // are what a caller cannot derive from the type.
    'The ONE party this call is about — a member (email or user id) or an agent (`@agent-<id>` or its handle). op="send": who it is FOR; op="manage": which of your own operator\'s agents; op="rooms": the member to "invite", or the one to open a 1:1 with.'),
    body: zod_1.z
        .string()
        .min(1)
        .max(16000)
        .optional()
        .describe(
    // ⚠ WHAT `body` MEANS PER `kind` IS THE DOCTRINE'S `send` SECTION, which
    // states both in full ("kind=\"milestone\": ONE line marking a step…",
    // "kind=\"decision\": … `body` what they need to know"). A field's describe
    // carries which ops take it and what it is; the per-kind shape is the op's
    // contract and is pulled with the op.
    'op="send" (required): the message text. op="manage" (required on "launch" and "direct"): the agent\'s opening instruction, or the private message.'),
    // ⚠ THREE VALUES, EACH WITH A FENCE (spec §2.1). `milestone` stores
    // `task_progress` and keeps G14's one-line cap; `decision` stores `message`
    // plus the validated escalation payload, and it MUST stay `message` or
    // `targeting.js › classify` drops the card and the human it asks is never
    // notified. ⚠ `question` / `blocked` / `done` are NOT adopted: a value with no
    // distinct behaviour is prose wearing a schema.
    kind: zod_1.z
        .enum(["message", "milestone", "decision"])
        .optional()
        .describe(
    // ⚠ WHICH FIELDS A DECISION NEEDS IS SAID BY THOSE FIELDS AND BY THE
    // DOCTRINE, not a third time here: `options`' own describe says REQUIRED on
    // kind="decision", `recommendation`'s says "almost always right", and the
    // doctrine's `send` section lists the four parts of a card together. This
    // one keeps what the VALUES mean, which is the enum's own contract.
    'op="send" (optional, default "message"): "milestone" marks a step on a thread and addresses nobody; "decision" posts a card a person answers with one press.'),
    thread: zod_1.z
        .string()
        .optional()
        .describe(
    // ⚠ THE LEGACY `task-<channel>-<seq>` LABEL IS STILL ACCEPTED — the doctrine's
    // `send` section is where it is explained now, with the consequence this
    // sentence never carried (no thread row behind it, so a send onto one
    // reports `landed=adhoc`). ⚠ "its metadata header plus only that exchange"
    // is PINNED by `channel-law.test.ts` against ARG_PROSE; it stays verbatim.
    'A thread id. ⚠ "new" on op="send" OPENS one and returns its id, with `summary` as its title. Required on op="send" kind="milestone" and on op="rooms" action="thread_mode"; on op="read" it narrows to its metadata header plus only that exchange.'),
    summary: zod_1.z
        .string()
        .trim()
        .max(200)
        .optional()
        .describe(
    // ⚠ THE THREAD-TITLE CLAUSE CAME OFF UNDER THIS FILE'S OWN NO-FACT-TWICE
    // RULE, the one the `name` field applied in 2026-09-06: `thread`'s describe
    // already says thread="new" opens one "with `summary` as its title", and
    // both strings are pushed on the same connection. The other three meanings
    // have no second home and stay.
    'The one-line intent. ALWAYS set it on op="send" — it becomes the notification the receiving member sees; on kind="decision" it is the QUESTION the card asks, on op="rooms" action="open" it is the channel topic, and on op="artifact" it is what the folded run was about.'),
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
        .describe(
    // ⚠ THE COST OF RETRYING WITHOUT ONE IS STATED WHERE IT BITES: the doctrine's
    // `manage` section ("re-issuing without the SAME `client_msg_id` starts a
    // SECOND agent" — pinned by four suites) and its `fields` section
    // ("`client_msg_id` IS WHAT MAKES A RETRY SAFE", pinned by
    // `channel-schema-budget.test.ts`). ⚠ PER-AUTHOR and both op names are
    // PINNED here by `channel-schema-caps.test.ts` and stay verbatim.
    'op="send" / op="manage" / op="artifact" (optional): an idempotency key; a re-sent key hands back YOUR first call\'s result instead of acting twice. The dedupe is PER-AUTHOR on every op.'),
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
        .describe(
    // ⚠ "One option is not a question" WAS THE PROSE COPY OF `.min(2)`, which
    // the published schema enforces and states as `minItems`. The doctrine's
    // `send` section carries the shape of a card ("`options` 2-6 choices each
    // with its consequence"), so the rule is both enforced and taught.
    'op="send" with kind="decision" (required): 2-6 things a person could decide, each with the consequence of choosing it.'),
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
        .describe(
    // ⚠ ITS OWN TWO PROPERTIES SAY WHAT IT IS — `index` "the one you would
    // take", `why` "ONE line for why" — and both are pushed on the same
    // connection as this line was. What only the parent can say is the
    // cross-field rule, which is what is left.
    'op="send" with kind="decision" (optional but almost always right): `index` MUST be inside `options` — an out-of-range one refuses the whole call.'),
    // ── op="artifact" ────────────────────────────────────────────────────────
    // ⚠ TWO FIELDS FOR FOUR ACTIONS, and the name+summary+key they also need are
    // the ones this surface already has. An artifact is named like a room, summed
    // up like a thread and retried like a send; three more params would have been
    // three more spellings for fields already declared above.
    // ⚠ **NO `.uuid()`, AND THE REASON IS A PUBLISHED-SCHEMA RULE RATHER THAN A
    // LOOSER CONTRACT** (2026-09-06). Zod 4 renders `.uuid()` as BOTH `format` and
    // a `pattern` keyword, and `tool-style.test.ts › the reference's anti-patterns`
    // refuses ANY `pattern` on a published property: a regex is a rule the agent has
    // to reverse-engineer from a character class, and breaking it costs an opaque
    // -32602 instead of a sentence naming the argument. The remedy is the one that
    // test names — say the shape in the describe and let the handler answer with a
    // code — and the describe below does exactly that by pointing at where the id
    // comes from, which is more useful to a caller than the alphabet it is drawn
    // from. A malformed id now reaches `channel-ops-artifact.ts` and is refused
    // there by name.
    // ⚠ IT IS THE ONLY PROPERTY ON THIS SURFACE THAT PUBLISHED ONE: the other
    // `.uuid()` uses sit inside ARRAY ITEMS, where the keyword lands on the item
    // schema rather than on the property, which is why nothing caught them and why
    // this is not a licence to add one there.
    artifact: zod_1.z
        .string()
        .optional()
        .describe('op="artifact" (required on "add", "remove" and "dissolve"): the artifact id, exactly as action="create" returned it.'),
    // ⚠ **ONE PARAM, AND THE "EXACTLY ONE" RULE IS A SEAM CHECK RATHER THAN A
    // SECOND FIELD** (`channel-ops-artifact.ts › oneMessage`). A singular
    // `message` beside this would be the same field with a different bound, which
    // is how a caller learns to guess which spelling an action wants — the same
    // argument that made `to` one param for four namespaces.
    // ⚠ MESSAGES ARE NAMED BY `seq`, not by id: `seq` is what a read PRINTS and
    // what a citation quotes, so resolving ids first would be a second addressing
    // scheme for the same rows. Cap hand-mirrors
    // `src/features/channels/schema-artifacts.ts › ARTIFACT_CREATE_MAX_MESSAGES`.
    messages: zod_1.z
        .array(zod_1.z.coerce.number().int().positive())
        .min(1)
        .max(200)
        .optional()
        .describe(
    // ⚠ **THE LAST 11, TAKEN AS FILLER RATHER THAN AS A FACT** (budget wave
    // fix-up): "this call is about" said nothing the clause after the dash does
    // not say precisely — the whole set on one action, exactly one on the other
    // two. Every fact, every quoted action and the `seq` addressing rule are
    // untouched, and the handler states the same bound at the point of refusal
    // (`channel-ops-artifact.ts › oneMessage`). Nothing greps this string.
    'op="artifact" (required on "create", "add" and "remove"): the message `seq`s — the whole set on "create", exactly ONE on "add" and "remove".'),
    // ── op="read" ────────────────────────────────────────────────────────────
    // ⚠ coerce: MCP clients sometimes send numbers as strings, and strict
    // z.number() rejects those with an opaque -32602.
    since: zod_1.z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
    // ⚠ THE TABLE-WIDE CLAUSE IS THE DOCTRINE'S `fields` LINE ("ONE CURSOR
    // SPACE, ONE `since` — `seq` is table-wide, so one cursor covers every
    // channel"), which `channel-schema-budget.test.ts` pins. ⚠ BOTH HALVES OF
    // THE JOIN STAY VERBATIM: "THREAD-SCOPED read" and "hands back none" are
    // pinned twice over, by `channel-schema-caps.test.ts` AND
    // `channel-thread-scope.test.ts`, which reads them against the result line.
    'op="read" (optional, and REQUIRED with `wait_ms`): the last MESSAGE seq you have processed; only higher ones come back. A THREAD-SCOPED read hands back none.'),
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
    // (`HOLD_CAP_MS`); the directive lane clamps to its own, which it has
    // always done in code (`channel-ops-launch.ts › WAIT_CAP_MS`).
    wait_ms: zod_1.z.coerce
        .number()
        .int()
        .min(0)
        .max(channel_hold_budget_1.HOLD_CAP_MS)
        .optional()
        .describe(
    // ⚠ THE TIMEOUT RULE IS THE DOCTRINE'S, AND IN ITS STRONGER FORM: "A
    // TIMEOUT IS NOT A FAILURE: the request stays PENDING, and re-issuing
    // without the SAME `client_msg_id` starts a SECOND agent" — one sentence
    // carrying the consequence this copy left out, and pinned verbatim by
    // `channel-directions`, `channel-ops-agent-mode` and
    // `channel-ops-agent-doctrine`. Deleting the weaker copy loses nothing.
    'Optional HOLD. op="read": long-poll for messages after `since` instead of returning a page. op="manage": how long to hold for your operator\'s desktop to answer.'),
    // ── op="rooms" ───────────────────────────────────────────────────────────
    // ⚠ `name` SERVES TWO ACTIONS AND THEY ARE BOTH LABELS, which is why one field
    // can carry them: a channel's name and an agent's display label are the same
    // kind of thing — a string people read. Neither addresses anything.
    name: zod_1.z
        .string()
        .optional()
        .describe(
    // ⚠ THE 1:1 CLAUSE CAME OFF ON 2026-09-06 TO PAY FOR THE ARTIFACT ONE,
    // under this file's own no-fact-twice rule: `to`'s describe already says
    // op="rooms" takes it for "the one to open a 1:1 with", and both strings
    // are pushed on the same connection. The three pinned facts about a
    // rename (DISPLAY ONLY, the handle is the only address, it reaches no
    // server) are untouched.
    'op="rooms" action="open" (required for a NAMED channel): the channel name. op="manage" action="rename" (required): a DISPLAY ONLY label for that agent — 1-60 visible characters on ONE line, or "" to clear it — `@agent-<id>` stays the only address, nothing resolves an agent by its name, and the label reaches no server. op="artifact" action="create" (required): the card\'s name.'),
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
        .describe('op="rooms" action="help" (optional): ONE section instead of the whole document. Omit for everything, index of section names included.'),
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
        .describe(
    // ⚠ THE AMBIGUITY REFUSAL MOVED TO THE DOCTRINE'S `manage` SECTION, beside
    // the rest of the launch contract and the refusal table it belongs to. It
    // is the one genuine MOVE in this slice — the sentence had no second home,
    // so it was WRITTEN there before it was cut here.
    // ⚠ "THIS CHANNEL'S container" IS PINNED on this describe by
    // `channel-ops-launch-body.test.ts:232` and stays verbatim.
    'op="manage" action="launch" (optional): the AGENT TEMPLATE the new agent runs as — its id, or its exact name. It resolves in THIS CHANNEL\'S container under THE OPERATOR\'S visibility. Omit it to start a blank agent.'),
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
            .describe("How much MESSAGE freedom to ask for — narrowest first, floored for a windowless session."),
        chain: zod_1.z
            .enum(["inherit", "on", "off"])
            .optional()
            .describe('Launch only: may the new agent launch further agents? "on" is REFUSED rather than quietly narrowed when the channel forbids it.'),
    })
        .optional()
        .describe('op="manage" action="launch" / action="posture" (optional): how much freedom to ASK FOR. Your operator\'s machine narrows whatever you ask for to their own ceiling and never widens past it; omit an axis to run at that setting.'),
};
