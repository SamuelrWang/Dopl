/**
 * MCP tools for the user's skills.
 *
 * Two reads — `skill_list` (cheap discovery), `skill_get` (resolved
 * body + per-reference availability) — plus the full write surface
 * for agent-driven authoring:
 *
 *   skill_create / skill_update / skill_delete
 *   skill_list_files / skill_read_file
 *   skill_create_file / skill_write_file / skill_rename_file / skill_delete_file
 *   skill_authoring_guide   — fetches the framework on demand
 *
 * Writes are gated server-side by the per-skill `agent_write_enabled`
 * toggle. Calls without the toggle 403 with `SKILL_AGENT_WRITE_DISABLED`.
 *
 * Skills are folders of `.md` files; SKILL.md is the canonical
 * procedure entry point.
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
export declare function registerSkillTools(register: RegisterTool, client: DoplClient): void;
export {};
