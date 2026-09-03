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
import { z } from "zod";
/**
 * THE FIVE OPS AN AGENT SEES, and the only five it may pick from.
 *
 * ⚠ THE ORDER IS THE READING ORDER a model skims: the one write it makes most,
 * the two reads, then the two dispatchers.
 */
export declare const CHANNEL_OPS: readonly ["send", "read", "status", "manage", "rooms"];
export type ChannelOp = (typeof CHANNEL_OPS)[number];
/**
 * THE ONE REFUSAL FOR A WORD THAT IS NOT AN OP, written once and used twice
 * (slice B16): the schema's own zod error, and `channel.ts`'s exhaustive
 * `default` for a build where that validation did not run.
 *
 * ⚠ **WITHOUT IT, RETIREMENT IS A `-32602 invalid enum value`** — the opaque
 * failure B8's one-release redirect window existed to prevent, arriving one
 * release later. ⚠ **ONE LINE, AND IT NAMES THE FIVE**, because the replacement
 * for any retired name is one of five words; anything longer is the doctrine,
 * and `rooms(action="help")` is where that lives.
 *
 * ⚠ The caller's own word is echoed BOUNDED AND ON ONE LINE — it is the only
 * part of this sentence they wrote, and an unbounded multi-line echo is
 * structure a caller can forge inside our narration.
 */
export declare function unknownOpRefusal(op: unknown): string;
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
export declare const CHANNEL_ACTIONS: {
    readonly manage: readonly ["launch", "end", "rename", "posture", "direct"];
    readonly rooms: readonly ["list", "open", "invite", "members", "threads", "thread_mode", "update", "help"];
};
/** Every action name, as the published enum. ⚠ Derived, never restated. */
export declare const CHANNEL_ACTION_NAMES: [string, ...string[]];
export type ManageAction = (typeof CHANNEL_ACTIONS.manage)[number];
export type RoomsAction = (typeof CHANNEL_ACTIONS.rooms)[number];
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
export declare const SCHEMA_MAX_CHARS = 8410;
/**
 * ⚠ THE PER-FIELD HALF, AND IT IS THE ONE THAT ACTUALLY HOLDS THE LINE. A total
 * can absorb one 900-character paragraph by trimming nine short fields; this
 * cannot. A `.describe()` states the CONTRACT of one field — which ops take it,
 * what it is, its bound — in one sentence. The rule behind it belongs in
 * `channel-doctrine.ts › FIELDS`, which is PULLED by the agent that asks.
 */
export declare const PARAM_DESCRIPTION_MAX_CHARS = 400;
export declare const CHANNEL_INPUT_SHAPE: {
    response_format: z.ZodOptional<z.ZodEnum<{
        concise: "concise";
        detailed: "detailed";
    }>>;
    op: z.ZodEnum<{
        read: "read";
        status: "status";
        send: "send";
        manage: "manage";
        rooms: "rooms";
    }>;
    action: z.ZodOptional<z.ZodEnum<{
        [x: string]: string;
    }>>;
    channel: z.ZodOptional<z.ZodString>;
    to: z.ZodOptional<z.ZodString>;
    body: z.ZodOptional<z.ZodString>;
    kind: z.ZodOptional<z.ZodEnum<{
        message: "message";
        milestone: "milestone";
        decision: "decision";
    }>>;
    thread: z.ZodOptional<z.ZodString>;
    summary: z.ZodOptional<z.ZodString>;
    client_msg_id: z.ZodOptional<z.ZodString>;
    options: z.ZodOptional<z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        consequence: z.ZodString;
    }, z.core.$strip>>>;
    recommendation: z.ZodOptional<z.ZodObject<{
        index: z.ZodNumber;
        why: z.ZodString;
    }, z.core.$strip>>;
    since: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    wait_ms: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    name: z.ZodOptional<z.ZodString>;
    visibility: z.ZodOptional<z.ZodEnum<{
        private: "private";
        public: "public";
    }>>;
    mode: z.ZodOptional<z.ZodEnum<{
        interactive: "interactive";
        autonomous: "autonomous";
    }>>;
    info_card: z.ZodOptional<z.ZodObject<{
        hidden: z.ZodOptional<z.ZodArray<z.ZodString>>;
        rows: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            label: z.ZodString;
            value: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
    section: z.ZodOptional<z.ZodEnum<{
        read: "read";
        fields: "fields";
        send: "send";
        manage: "manage";
        law: "law";
        model: "model";
        rooms: "rooms";
    }>>;
    model: z.ZodOptional<z.ZodString>;
    template: z.ZodOptional<z.ZodString>;
    posture: z.ZodOptional<z.ZodObject<{
        tools: z.ZodOptional<z.ZodEnum<{
            manual: "manual";
            accept_edits: "accept_edits";
            auto: "auto";
            bypass: "bypass";
        }>>;
        messages: z.ZodOptional<z.ZodEnum<{
            ask: "ask";
            auto_inbound: "auto_inbound";
            auto_outbound: "auto_outbound";
            auto_both: "auto_both";
        }>>;
        chain: z.ZodOptional<z.ZodEnum<{
            on: "on";
            off: "off";
            inherit: "inherit";
        }>>;
    }, z.core.$strip>>;
};
