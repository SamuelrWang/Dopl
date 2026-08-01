/**
 * THE PUBLISHED INPUT SHAPE for `dopl_channel` — one flat schema of optional
 * params, plus the `op` discriminator, with the per-op requirements enforced at
 * runtime by `missingParams` in the registrar.
 *
 * Split out of `channel.ts` at the §2 500-line cap alongside
 * `channel-description.ts`. The seam is the same one: this is the DECLARED
 * SURFACE an MCP client introspects (names, types, caps, and the prose that
 * teaches each param), while the registrar is routing. The parity suite reads
 * both — every declared param must be referenced by some handler in the
 * `channel-*` group, and no handler may read an arg that is not declared here.
 *
 * The caps below MIRROR the routes' own zod schemas
 * (src/features/channels/schema.ts): title 200, body 16000, summary 2000 (the
 * tighter 200 applies to a post's summary), client_msg_id 200. Declared here
 * they are published in the tool's inputSchema (the model sees a maxLength) and
 * enforced before the call is made at all. `.trim()` where — and only where —
 * the route trims before measuring, so the two agree on what "200 characters"
 * counts.
 */
import { z } from "zod";
export declare const CHANNEL_INPUT_SHAPE: {
    op: z.ZodEnum<{
        open: "open";
        members: "members";
        list: "list";
        read: "read";
        invite: "invite";
        post: "post";
        await: "await";
        list_threads: "list_threads";
        get_thread: "get_thread";
        create_thread: "create_thread";
        close_thread: "close_thread";
        set_thread_mode: "set_thread_mode";
        agents: "agents";
        summon_agent: "summon_agent";
        rename_agent: "rename_agent";
        set_agent_status: "set_agent_status";
        join_thread: "join_thread";
        leave_thread: "leave_thread";
    }>;
    channel: z.ZodOptional<z.ZodString>;
    direct: z.ZodOptional<z.ZodBoolean>;
    name: z.ZodOptional<z.ZodString>;
    topic: z.ZodOptional<z.ZodString>;
    visibility: z.ZodOptional<z.ZodEnum<{
        public: "public";
        private: "private";
    }>>;
    member: z.ZodOptional<z.ZodString>;
    agent: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        summoned: "summoned";
        parked: "parked";
        dismissed: "dismissed";
    }>>;
    to_agent: z.ZodOptional<z.ZodString>;
    as_agent: z.ZodOptional<z.ZodString>;
    participants: z.ZodOptional<z.ZodArray<z.ZodString>>;
    body: z.ZodOptional<z.ZodString>;
    to: z.ZodOptional<z.ZodString>;
    summary: z.ZodOptional<z.ZodString>;
    kind: z.ZodOptional<z.ZodEnum<{
        message: "message";
        task_started: "task_started";
        task_progress: "task_progress";
        task_finished: "task_finished";
        task_failed: "task_failed";
    }>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    client_msg_id: z.ZodOptional<z.ZodString>;
    title: z.ZodOptional<z.ZodString>;
    mode: z.ZodOptional<z.ZodEnum<{
        interactive: "interactive";
        autonomous: "autonomous";
    }>>;
    thread: z.ZodOptional<z.ZodString>;
    outcome: z.ZodOptional<z.ZodEnum<{
        completed: "completed";
        failed: "failed";
    }>>;
    since: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    timeout_ms: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
};
