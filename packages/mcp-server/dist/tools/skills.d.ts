/**
 * MCP tools for the user's skills. A skill is SINGLE-FILE: one tight markdown
 * procedure (SKILL.md) plus metadata; long reference material belongs in
 * knowledge bases (`dopl://kb/<slug>`). ⚠ Writes are gated server-side by the
 * per-skill `agent_write_enabled` toggle — without it, 403
 * `SKILL_AGENT_WRITE_DISABLED`.
 *
 * ⚠ ONE TOOL: reads + non-destructive writes. There is no delete op and no
 * `dopl_skill_admin` (deleted 2026-09-02) — deletion is app-only, fenced by
 * `sessionOnly` on `DELETE /api/skills/[skillSlug]`.
 *
 * Thin registrar: one description + schema + op routing, delegating to
 * `skills-shared.ts`, `skills-ops-read.ts`, `skills-ops-write.ts`. ⚠ The
 * `skills-` prefix is what the parity split-scan groups on.
 */
import type { DoplClient } from "@dopl/client";
import { type CallerIdentity } from "./identity";
import { type RegisterTool } from "./respond";
export declare function registerSkillTools(register: RegisterTool, client: DoplClient, caller?: CallerIdentity): void;
