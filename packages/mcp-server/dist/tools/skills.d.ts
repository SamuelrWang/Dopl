/**
 * MCP tools for the user's skills.
 *
 * Skills are folders of `.md` files; SKILL.md is the canonical procedure
 * entry point. Writes are gated server-side by the per-skill
 * `agent_write_enabled` toggle; calls without the toggle 403 with
 * `SKILL_AGENT_WRITE_DISABLED`.
 *
 * Consolidated into two `op`-dispatched tools (the canonical pattern from
 * `setups.ts`):
 *   - `dopl_skill`       — reads + non-destructive writes.
 *   - `dopl_skill_admin` — DESTRUCTIVE deletes, split out on purpose.
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerSkillTools(register: RegisterTool, client: DoplClient): void;
