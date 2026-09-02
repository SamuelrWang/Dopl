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
import { z } from "zod";
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
export declare const SCHEMA_MAX_CHARS = 11103;
/**
 * ⚠ THE PER-FIELD HALF, AND IT IS THE ONE THAT ACTUALLY HOLDS THE LINE. A total
 * can absorb one 900-character paragraph by trimming nine short fields; this
 * cannot. A `.describe()` states the CONTRACT of one field — which ops take it,
 * what it is, its bound — in one sentence. The rule behind it belongs in
 * `channel-doctrine.ts › FIELDS`, which is PULLED by the agent that asks.
 */
export declare const PARAM_DESCRIPTION_MAX_CHARS = 400;
export declare const CHANNEL_INPUT_SHAPE: {
    op: z.ZodEnum<{
        open: "open";
        set_agent_mode: "set_agent_mode";
        read: "read";
        list: "list";
        update: "update";
        members: "members";
        invite: "invite";
        post: "post";
        milestone: "milestone";
        create_thread: "create_thread";
        set_thread_mode: "set_thread_mode";
        escalate: "escalate";
        direct_agent: "direct_agent";
        launch_agent: "launch_agent";
        end_agent: "end_agent";
        rename_agent: "rename_agent";
        ping: "ping";
        read_directions: "read_directions";
        read_sessions: "read_sessions";
        help: "help";
        await: "await";
        list_threads: "list_threads";
        pings: "pings";
    }>;
    section: z.ZodOptional<z.ZodEnum<{
        law: "law";
        model: "model";
        protocol: "protocol";
        adhoc: "adhoc";
        main_room: "main_room";
        tagging: "tagging";
        milestones: "milestones";
        escalation: "escalation";
        awaiting: "awaiting";
        agents: "agents";
        refusals: "refusals";
        sessions: "sessions";
        fields: "fields";
        conventions: "conventions";
    }>>;
    channel: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    topic: z.ZodOptional<z.ZodString>;
    visibility: z.ZodOptional<z.ZodEnum<{
        private: "private";
        public: "public";
    }>>;
    member: z.ZodOptional<z.ZodString>;
    body: z.ZodOptional<z.ZodString>;
    to: z.ZodOptional<z.ZodString>;
    summary: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    client_msg_id: z.ZodOptional<z.ZodString>;
    title: z.ZodOptional<z.ZodString>;
    mode: z.ZodOptional<z.ZodEnum<{
        interactive: "interactive";
        autonomous: "autonomous";
    }>>;
    handoff: z.ZodOptional<z.ZodBoolean>;
    thread: z.ZodOptional<z.ZodString>;
    agent_id: z.ZodOptional<z.ZodString>;
    ping_kind: z.ZodOptional<z.ZodEnum<{
        blocked: "blocked";
        done: "done";
        question: "question";
    }>>;
    recipient: z.ZodOptional<z.ZodString>;
    since: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    goal: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    template: z.ZodOptional<z.ZodString>;
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
    wait_ms: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    info_card: z.ZodOptional<z.ZodObject<{
        hidden: z.ZodOptional<z.ZodArray<z.ZodString>>;
        rows: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            label: z.ZodString;
            value: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
    issue: z.ZodOptional<z.ZodString>;
    context: z.ZodOptional<z.ZodString>;
    options: z.ZodOptional<z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        consequence: z.ZodString;
    }, z.core.$strip>>>;
    recommendation: z.ZodOptional<z.ZodObject<{
        index: z.ZodNumber;
        why: z.ZodString;
    }, z.core.$strip>>;
    limit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    timeout_ms: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
};
