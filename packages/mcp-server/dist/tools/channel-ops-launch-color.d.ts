import { z } from "zod";
import type { AgentColorKey } from "@dopl/client";
import { type ToolResponse } from "./respond";
/**
 * Agent colour for `manage action="launch"`: the sixteen keys, the published `color` field and the
 * 409 colour-taken refusal. A colour is a marker, never a status. Error `details` are duck-typed.
 */
/**
 * The sixteen keys in the server's pick order (the refusal's first free key is the one it would pick).
 * Hand mirror of `src/features/channels/lib/agent-colors.ts › AGENT_COLOR_KEYS`, held to the union by
 * `satisfies` and pinned by `channel-ops-launch-color.test.ts`. An enum: a published `pattern` is forbidden (`tool-style.test.ts`).
 */
export declare const AGENT_COLOR_KEYS: readonly ["agent-01", "agent-02", "agent-03", "agent-04", "agent-05", "agent-06", "agent-07", "agent-08", "agent-09", "agent-10", "agent-11", "agent-12", "agent-13", "agent-14", "agent-15", "agent-16"];
/** Narrows (never casts) the dispatch arg; absent and unrecognized both mean the server picks the first free key. */
export declare function asAgentColorKey(value: string | undefined): AgentColorKey | undefined;
/** The 409's `details.free`, shape-checked; `[]` when absent or malformed. */
export declare function freeColors(e: unknown): string[];
/** `err`, because nothing was filed; lists the free keys and asks for the same `client_msg_id` on retry. */
export declare function colorTaken(wanted: string, free: string[]): ToolResponse;
/** The published `color` field (via `channel-schema-launch-fields.ts`); its standing rules live in `channel-doctrine.ts › FIELDS`. */
export declare const AGENT_COLOR_FIELD: z.ZodOptional<z.ZodEnum<{
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
