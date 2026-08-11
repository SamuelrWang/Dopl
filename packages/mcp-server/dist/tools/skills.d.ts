/**
 * MCP tools for the user's skills.
 *
 * A skill is SINGLE-FILE: one tight markdown procedure (its SKILL.md)
 * plus metadata. Long reference material belongs in knowledge bases
 * (linked via `dopl://kb/<slug>`), not in the skill. Writes are gated
 * server-side by the per-skill `agent_write_enabled` toggle; calls
 * without it 403 with `SKILL_AGENT_WRITE_DISABLED`.
 *
 * Consolidated into two `op`-dispatched tools (the canonical pattern from
 * `setups.ts`):
 *   - `dopl_skill`       — reads + non-destructive writes.
 *   - `dopl_skill_admin` — the delete surface, refusing since §2b (app-only
 *                          deletion); the ops stay listed to teach the refusal.
 *
 * This file is the thin registrar: it owns the two tool descriptions + schemas
 * + op routing and delegates each op to a handler in a sibling module —
 *   - `skills-shared.ts`    — NO_NAME, the op="list" scope line, error mappers
 *   - `skills-ops-read.ts`  — list/get/read
 *   - `skills-ops-write.ts` — write/create/update/set_visibility + the delete
 * Split at the §2 500-line cap on the same seam `knowledge.ts` uses; the
 * `skills-` prefix is what the parity split-scan groups on.
 */
import type { DoplClient } from "@dopl/client";
import { type CallerIdentity } from "./identity";
import { type RegisterTool } from "./respond";
export declare function registerSkillTools(register: RegisterTool, client: DoplClient, caller?: CallerIdentity): void;
