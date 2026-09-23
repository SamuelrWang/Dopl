/**
 * THE `op="manage" action="launch"` SHAPE FIELDS — `model`, `identity`, `color`, `posture`.
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
    /**
     * **WHICH RUNTIME — A SECOND, SEPARATE FIELD, AND THE SEPARATION IS THE POINT** (2026-09-21,
     * U9 of the Codex runtime-parity plan).
     *
     * 🔒 **THE DEFECT, VERBATIM FROM THE PLAN**: *a live MCP launch carrying `model: "codex"` was
     * accepted but started a Claude Sonnet agent, because the MCP contract has no runtime field
     * and an unknown model falls through to the default adapter.* Both halves were true. There was
     * no runtime argument anywhere on this lane, and an unrecognised model id resolves to "no
     * model opinion" on the machine — so `codex` read as silence and the chain fell through.
     *
     * ⚠ **A SHAPE, NOT AN ENUM, AND THAT IS DELIBERATE** — the opposite call from `color` one
     * field down, for the opposite reason. The sixteen colour keys are OURS (two CSS files), so
     * anything else is a caller error worth naming. The runtime roster is the OPERATOR'S DESKTOP
     * REGISTRY and moves with a desktop release; an enum here would refuse a runtime a newer
     * machine ships, and it would cost the members' characters on every connection
     * (`channel-schema.ts › SCHEMA_MAX_CHARS`) to publish a list this process cannot keep current.
     * The machine decides membership, and it is also the only party that can say whether the
     * runtime would actually start.
     *
     * ⚠ **THE REFUSAL IS THE CONTRACT AND IS STATED IN THE DESCRIBE**, because it is the one thing
     * a caller cannot derive and the one thing it must plan for: an explicit runtime the operator's
     * machine cannot start comes back REFUSED, never quietly launched on another vendor.
     */
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
