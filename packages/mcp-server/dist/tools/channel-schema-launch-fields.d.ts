/**
 * The `op="manage" action="launch"` shape fields. Spread LAST into `CHANNEL_INPUT_SHAPE` so the served
 * schema stays byte-stable (`channel-schema-budget.test.ts` and `tool-budget.test.ts` fail both ways).
 */
import { z } from "zod";
/**
 * The granular `posture` (Context Economy W1, 2026-10-12): the listing publishes only the three
 * levels; every runtime word is still ACCEPTED (the enum validates) and the doctrine's FIELDS names
 * them. The legacy field above is unchanged (`legacy-surface.test.ts`, DMP-013).
 */
export declare const GRANULAR_POSTURE_FIELD: z.ZodOptional<z.ZodObject<{
    tools: z.ZodOptional<z.ZodEnum<{
        granular: "granular";
        full: "full";
        ask: "ask";
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
        default: "default";
        promptUnmatched: "promptUnmatched";
        onRequest: "onRequest";
        allowAll: "allowAll";
        autoMode: "autoMode";
        "approve-all": "approve-all";
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
export declare const LAUNCH_INPUT_FIELDS: {
    model: z.ZodOptional<z.ZodString>;
    /** A free string on purpose: the desktop registry decides membership. Separate from `model`; neither is derived from the other. */
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
            full: "full";
            ask: "ask";
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
            default: "default";
            promptUnmatched: "promptUnmatched";
            onRequest: "onRequest";
            allowAll: "allowAll";
            autoMode: "autoMode";
            "approve-all": "approve-all";
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
