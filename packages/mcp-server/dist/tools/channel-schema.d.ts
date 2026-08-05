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
 *
 * F5 (2026-08-01) — THE MINIMUMS MIRROR TOO. `body` / `client_msg_id` / `title`
 * carried a maximum and no minimum while the route required `.min(1)` on all
 * three, so an empty body, a blank idempotency key and a whitespace-only title
 * each passed the tool and died at the route as an opaque 400 that the write ops
 * then mis-narrated (see `channel-errors.ts`). A client-side refusal is a -32602
 * that names the field.
 *
 * THE NAMED-AGENT PARAMS ARE GONE (channels rollback §1, 2026-08-05):
 * `to_agent` / `to_agents` / `as_agent` / `participants` / `status`, and the
 * seven ops that read them. They are DROPPED FROM THE ENUM rather than kept for
 * a teaching refusal, unlike `close_thread` below — a removed op whose
 * capability is genuinely gone gets a plain "invalid enum value", which is the
 * honest answer, where `close_thread`'s capability moved and its refusal names
 * where it moved to.
 *
 * `summary` IS DELIBERATELY NOT SPLIT and its declared 2000 stays. One param
 * serves two routes with two caps (post 200, close_thread 2000) and this schema
 * declares the LOOSER one so a legitimate close summary is never refused
 * client-side; the tighter number is stated in its `.describe()`. See the note
 * above the field.
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
    thread: z.ZodOptional<z.ZodString>;
    outcome: z.ZodOptional<z.ZodEnum<{
        completed: "completed";
        failed: "failed";
    }>>;
    since: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    timeout_ms: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
};
