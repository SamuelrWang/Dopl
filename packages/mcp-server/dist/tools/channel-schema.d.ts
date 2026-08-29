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
export declare const CHANNEL_INPUT_SHAPE: {
    op: z.ZodEnum<{
        list: "list";
        read: "read";
        update: "update";
        members: "members";
        open: "open";
        invite: "invite";
        post: "post";
        milestone: "milestone";
        create_thread: "create_thread";
        set_thread_mode: "set_thread_mode";
        launch_agent: "launch_agent";
        await: "await";
        list_threads: "list_threads";
        get_thread: "get_thread";
        read_sessions: "read_sessions";
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
    since: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    goal: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    template: z.ZodOptional<z.ZodString>;
    wait_ms: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    info_card: z.ZodOptional<z.ZodObject<{
        hidden: z.ZodOptional<z.ZodArray<z.ZodString>>;
        rows: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            label: z.ZodString;
            value: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
    limit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    timeout_ms: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
};
