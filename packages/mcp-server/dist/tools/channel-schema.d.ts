/**
 * THE PUBLISHED INPUT SHAPE for `dopl_channel` — one flat schema of optional params, plus the
 * `op` discriminator and the `action` sub-verb the two dispatching ops take, with the per-op
 * requirements enforced at runtime by `missingParams` in the registrar.
 *
 * This is the DECLARED SURFACE an MCP client introspects (names, types, caps, per-param
 * teaching); the registrar is routing. ⚠ The parity suite reads both: every declared param must
 * be referenced by some handler in the `channel-*` group, and no handler may read an arg not
 * declared here.
 *
 * ⚠ **FIVE OPS SINCE 2026-09-02 (MCP v2 wave B slice B8, Samuel's ruling B9), AND FIVE AT RUNTIME
 * TOO SINCE SLICE B16.** `send` · `read` · `status` · `manage` · `rooms`, down from twenty-three.
 * The other twenty-two names parsed for one release and answered a one-line redirect; that window
 * is CLOSED, so the runtime enum and the published one are the same five and a retired name is
 * refused by schema validation with {@link unknownOpRefusal}'s line. The names are kept as dead
 * vocabulary in `law-removed-vocabulary.ts › RETIRED_CHANNEL_OPS`, which is what stops a shipped
 * string teaching one.
 *
 * ⚠ **EVERY `.describe()` HERE IS PUSHED ON EVERY CONNECTION, EXACTLY LIKE THE TOOL DESCRIPTION,
 * AND IS BUDGETED LIKE ONE** (A6, 2026-09-02). It was 20,844 characters over 46 blocks — 11.7×
 * the description the T82 cap governs — because each block carried the RULE behind its field as
 * well as its contract. A rule belongs in `channel-doctrine.ts`, which is PULLED by the agent
 * that asks for it; a `.describe()` carries the CONTRACT of one field and stops. One sentence
 * each, and `channel-schema-budget.test.ts` is what keeps it there.
 *
 * ⚠ **NO `.describe()` HAND-TYPES A BOUND THE SCHEMA PUBLISHES.** A cap reaches the client as a
 * `maxLength` / `maximum` keyword and once more in the description's rendered `Limits:` block
 * (`tool-style.ts › renderLimits`); a third copy in the prose is the copy that goes stale, and
 * `tool-style.test.ts` fails one.
 *
 * ⚠ Caps and minimums HAND-MIRROR the routes' zod schemas (src/features/channels/schema.ts): body
 * 16000, summary 200, client_msg_id 200, `.min(1)` on body / client_msg_id. Declared here they
 * publish as maxLength and are enforced before the call; omit one and the route rejects it as an
 * opaque 400 the write ops mis-narrate. `.trim()` where — and ONLY where — the route trims before
 * measuring, so the two agree on what a character count counts.
 *
 * ⚠ **`summary` IS ONE NUMBER NOW (200), AND THAT IS A RULING** (Samuel, wave B). It declared the
 * LOOSER 2000 so an over-length summary would be the route's to refuse with the field named; the
 * route enforces 200, so the schema published a cap the surface does not have. One field, one
 * bound, both ends.
 */
import { z } from "zod";
export { CHANNEL_OPS, CHANNEL_ACTIONS, CHANNEL_ACTION_NAMES, unknownOpRefusal, unknownActionRefusal, } from "./channel-vocab";
export type { ChannelOp, ManageAction, RoomsAction, ArtifactAction, } from "./channel-vocab";
/**
 * THE INPUT-SCHEMA BUDGET, and it is the same budget as the description's (A6, 2026-09-02). A
 * tool's `inputSchema` is PUSHED on every connection exactly as its description is, and
 * `dopl_channel`'s was **21,778 chars served — 11.7× the 1,775 the T82 cap governs** — because 46
 * `.describe()` blocks carried the RULE behind each field as well as its contract.
 *
 * ⚠ MEASURED AS **SERVED**, over a real `Client.listTools()`, and with the registrar-injected
 * `workspace` argument EXCLUDED: that one belongs to `registrar.ts › WORKSPACE_ARG_SHAPE` and is
 * a different slice's to shrink, so counting it here would let this ratchet move on somebody
 * else's edit. ⚠ IT ONLY EVER MOVES DOWN. `channel-schema-budget.test.ts` fails both ways —
 * growing past it, and shrinking below it without lowering the number. / // ⚠ 11,341 → 8,410 ON
 * 2026-09-02 (B8), AND EVERY CHARACTER OF IT CAME FROM // DELETING PARAMS AND OPS RATHER THAN
 * FROM SHORTENING PROSE. Thirteen params // left the shape — `topic`, `member`, `title`,
 * `handoff`, `agent_id`, // `ping_kind`, `recipient`, `metadata`, `goal`, `issue`, `context`, //
 * `timeout_ms`, and the three posture axes, which became one `posture` object — // because the
 * concept each named already had a field: a recipient is `to`, an // intent is `summary`, a goal
 * is `body`, a hold is `wait_ms`. Eighteen op names // left the published enum. A cut a re-worded
 * sentence cannot make twice.
 */
export declare const SCHEMA_MAX_CHARS = 8715;
/**
 * ⚠ THE PER-FIELD HALF, AND IT IS THE ONE THAT ACTUALLY HOLDS THE LINE. A total can absorb one
 * 900-character paragraph by trimming nine short fields; this cannot. A `.describe()` states the
 * CONTRACT of one field — which ops take it, what it is, its bound — in one sentence. The rule
 * behind it belongs in `channel-doctrine.ts › FIELDS`, which is PULLED by the agent that asks.
 */
export declare const PARAM_DESCRIPTION_MAX_CHARS = 400;
export declare const CHANNEL_INPUT_SHAPE: {
    model: z.ZodOptional<z.ZodString>;
    template: z.ZodOptional<z.ZodString>;
    color: z.ZodOptional<z.ZodEnum<{
        "agent-01": "agent-01";
        "agent-02": "agent-02";
        "agent-03": "agent-03";
        "agent-04": "agent-04";
        "agent-05": "agent-05";
        "agent-06": "agent-06";
        "agent-07": "agent-07";
        "agent-08": "agent-08";
        "agent-09": "agent-09";
        "agent-10": "agent-10";
        "agent-11": "agent-11";
        "agent-12": "agent-12";
        "agent-13": "agent-13";
        "agent-14": "agent-14";
        "agent-15": "agent-15";
        "agent-16": "agent-16";
    }>>;
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
        waiting: "waiting";
        rooms: "rooms";
    }>>;
    artifact: z.ZodOptional<z.ZodString>;
    messages: z.ZodOptional<z.ZodArray<z.ZodCoercedNumber<unknown>>>;
    since: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    wait_ms: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    options: z.ZodOptional<z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        consequence: z.ZodString;
    }, z.core.$strip>>>;
    recommendation: z.ZodOptional<z.ZodObject<{
        index: z.ZodNumber;
        why: z.ZodString;
    }, z.core.$strip>>;
    response_format: z.ZodOptional<z.ZodEnum<{
        concise: "concise";
        detailed: "detailed";
    }>>;
    op: z.ZodEnum<{
        status: "status";
        read: "read";
        send: "send";
        manage: "manage";
        artifact: "artifact";
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
        record: "record";
        milestone: "milestone";
        decision: "decision";
    }>>;
    thread: z.ZodOptional<z.ZodString>;
    summary: z.ZodOptional<z.ZodString>;
    client_msg_id: z.ZodOptional<z.ZodString>;
};
