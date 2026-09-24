/**
 * Published input shape for `dopl_channel`: one flat schema; per-op requirements are enforced at
 * runtime by `missingParams`. Parity suite: every param is read by some `channel-*` handler and no
 * handler reads an undeclared one. Every `.describe()` is pushed on every connection and budgeted
 * (`channel-schema-budget.test.ts`): a rule goes in the pulled `channel-doctrine.ts › FIELDS`, a
 * describe carries one field's contract and never hand-types a bound the schema publishes.
 * Caps hand-mirror the route zod (`src/features/channels/schema.ts`); `.trim()` only where it trims.
 */
import { z } from "zod";
export declare const SCHEMA_MAX_CHARS = 9155;
export declare const PARAM_DESCRIPTION_MAX_CHARS = 400;
export declare const CHANNEL_INPUT_SHAPE: {
    model: z.ZodOptional<z.ZodString>;
    runtime: z.ZodOptional<z.ZodString>;
    identity: z.ZodOptional<z.ZodString>;
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
            granular: "granular";
            manual: "manual";
            accept_edits: "accept_edits";
            auto: "auto";
            bypass: "bypass";
            untrusted: "untrusted";
            "on-request": "on-request";
            never: "never";
            allowlist: "allowlist";
            "auto-review": "auto-review";
            "run-everything": "run-everything";
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
        send: "send";
        manage: "manage";
        model: "model";
        fields: "fields";
        read: "read";
        law: "law";
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
        send: "send";
        manage: "manage";
        artifact: "artifact";
        status: "status";
        read: "read";
        rooms: "rooms";
    }>;
    action: z.ZodOptional<z.ZodEnum<{
        [x: string]: string;
    }>>;
    channel: z.ZodOptional<z.ZodString>;
    to: z.ZodOptional<z.ZodString>;
    body: z.ZodOptional<z.ZodString>;
    kind: z.ZodOptional<z.ZodEnum<{
        decision: "decision";
        message: "message";
        record: "record";
        milestone: "milestone";
    }>>;
    thread: z.ZodOptional<z.ZodString>;
    summary: z.ZodOptional<z.ZodString>;
    client_msg_id: z.ZodOptional<z.ZodString>;
};
