/**
 * THE `op="rooms"` LANE'S FIELDS — their own module since 2026-09-18, for the
 * same reason `channel-schema-launch-fields.ts` is one: `channel-schema.ts` sits
 * AT §1's 500-line cap (the `size-check` CI job, F-689), so a parameter that
 * grows by a line has nowhere to grow.
 *
 * ⚠ **THE SEAM IS A REASON TO CHANGE.** These five move when the ROOMS lane
 * moves; the recipient, send and read fields move for their own reasons. Nothing
 * else is in here and nothing here is re-exported under a second name.
 *
 * ⚠ **SPREAD IN THEIR ORIGINAL POSITION** by `channel-schema.ts`, so the
 * PUBLISHED SCHEMA IS UNCHANGED — not one served character moved with the file.
 * `channel-schema-budget.test.ts` measures the composed shape, so a drift here
 * fails there rather than passing quietly.
 *
 * ⚠ Every `.describe()` here is PUSHED on every connection and is held to
 * `channel-schema.ts › PARAM_DESCRIPTION_MAX_CHARS`. A RULE belongs in
 * `channel-doctrine.ts › ROOMS`, which is PULLED by the agent that asks.
 */
import { z } from "zod";
export declare const ROOMS_INPUT_FIELDS: {
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
};
