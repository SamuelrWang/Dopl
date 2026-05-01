/**
 * MCP tools for managing the user's knowledge bases (Item 4).
 *
 * 17 tools total. The agent talks to these like a filesystem:
 * `kb_write_file`, `kb_read_file`, `kb_create_folder`, `kb_list_dir`,
 * `kb_move_file`. Bases are addressed by slug (or id — both work);
 * folders/entries by `/`-separated path.
 *
 * Distinct from the read-only knowledge-pack tools (`kb_list_packs`,
 * `kb_list`, `kb_get`) in server.ts: those expose Dopl's own curated
 * specialist verticals; these expose the user's own editable bases.
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
export declare function registerKnowledgeTools(register: RegisterTool, client: DoplClient): void;
export {};
