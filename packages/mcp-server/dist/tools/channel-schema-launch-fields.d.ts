/**
 * THE `op="manage" action="launch"` SHAPE FIELDS — `model`, `template`, `color`, `posture`.
 *
 * ⚠ **ITS OWN MODULE BECAUSE `channel-schema.ts` WAS OVER THE 500-LINE CAP** (§1; the
 * `size-check` CI job and `max-lines` in `eslint.config.mjs`, F-689), and this is the seam
 * `channel-ops-launch-color.ts` already drew one field at a time: the launch lane's arguments
 * change together and change for a different reason from the send/read ones.
 *
 * ⚠ **SPREAD INTO `CHANNEL_INPUT_SHAPE` IN ITS ORIGINAL POSITION — LAST — SO THE PUBLISHED
 * SCHEMA IS BYTE-FOR-BYTE WHAT IT WAS.** `channel-schema-budget.test.ts › SCHEMA_MAX_CHARS`
 * and `tool-budget.test.ts` both fail in BOTH directions, so a move that changed one served
 * character would fail rather than pass quietly.
 *
 * ⚠ THE BUDGET ARGUMENT FOR EVERY `.describe()` BELOW IS STATED ONCE, at
 * `channel-schema.ts › SCHEMA_MAX_CHARS`, and is not restated here.
 */
import { z } from "zod";
export declare const LAUNCH_INPUT_FIELDS: {
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
};
