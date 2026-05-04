/**
 * MCP tools for connecting third-party services (Notion, Gmail,
 * Drive) and pulling content from them into the user's Dopl
 * workspace as fully-synthesized entries.
 *
 * Four tools, all generic on `provider`:
 *   - `connect_integration`         — start (or check) the OAuth flow
 *   - `integration_status`          — re-poll connection state
 *   - `list_integration_objects`    — search/enumerate the connected service
 *   - `ingest_from_integration`     — fetch one object and produce a
 *                                     prepare-shaped bundle. Agent then
 *                                     calls existing `submit_ingested_entry`.
 *
 * Branding note: tool descriptions never mention the OAuth broker we
 * use under the hood. The agent only sees a Dopl-branded auth URL.
 */
import { z, type ZodRawShape } from "zod";
import type { DoplClient } from "@dopl/client";
type ToolResponse = {
    content: Array<{
        type: "text";
        text: string;
    }>;
    isError?: boolean;
};
export type RegisterTool = <S extends ZodRawShape>(name: string, description: string, schema: S, handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResponse>) => void;
export declare function registerIntegrationTools(register: RegisterTool, client: DoplClient): void;
export {};
