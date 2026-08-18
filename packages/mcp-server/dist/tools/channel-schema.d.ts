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
 * ⚠ `summary` is deliberately NOT split: one param serves two routes with two
 * caps, and this declares the LOOSER so a legitimate close summary is never
 * refused client-side. The tighter number is stated in its `.describe()`.
 */
import { z } from "zod";
export declare const CHANNEL_INPUT_SHAPE: {
    op: z.ZodEnum<{
        list: "list";
        read: "read";
        members: "members";
        open: "open";
        invite: "invite";
        post: "post";
        milestone: "milestone";
        await: "await";
        list_threads: "list_threads";
        get_thread: "get_thread";
        read_sessions: "read_sessions";
        create_thread: "create_thread";
        propose_close: "propose_close";
        close_thread: "close_thread";
        set_thread_mode: "set_thread_mode";
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
    intent: z.ZodOptional<z.ZodEnum<{
        chat: "chat";
        request: "request";
    }>>;
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
    handoff: z.ZodOptional<z.ZodBoolean>;
    thread: z.ZodOptional<z.ZodString>;
    outcome: z.ZodOptional<z.ZodEnum<{
        completed: "completed";
        failed: "failed";
    }>>;
    since: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    timeout_ms: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
};
