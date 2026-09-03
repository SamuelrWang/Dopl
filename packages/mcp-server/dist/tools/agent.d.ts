/**
 * `dopl_agent` — AGENT TEMPLATES, the persistent agent IDENTITIES a user authors
 * once and launches many times. ⚠ There is no delete op and no
 * `dopl_agent_admin` (deleted 2026-09-02) — deletion is app-only, and
 * `DELETE /api/agent-templates/{id}` has been `sessionOnly` since 2026-08-22.
 *
 * ⚠ THE NAME IS A DELIBERATE COLLISION, RESOLVED BY SAMUEL (ruling Q7,
 * 2026-08-28). "Agents" already names TWO surfaces — the identities on /home and
 * the RUNNING SESSIONS in a channel's info column (INVARIANTS §5A) — and
 * renaming either needs his word. `dopl_agent` matches the operator's noun and
 * the /home tab; the tool DESCRIPTION carries the disambiguating sentence so an
 * agent reaching for "the agents in this channel" is sent to
 * `dopl_channel(op="read_sessions")` instead of here.
 *
 * Thin registrar: one description + schema + op routing, delegating to
 *   - `agent-shared.ts`    — the three-answer ref resolution + error mappers
 *   - `agent-ops-read.ts`  — list / get
 *   - `agent-ops-write.ts` — create / update / grant (confirm gate + grant fence)
 * ⚠ The `agent-` prefix is what the parity split-scan groups on.
 */
import type { DoplClient } from "@dopl/client";
import { type CallerIdentity } from "./identity.js";
import { type RegisterTool } from "./respond.js";
import type { WorkspaceDirectory } from "../workspace-directory.js";
export declare function registerAgentTools(register: RegisterTool, client: DoplClient, caller: CallerIdentity | undefined, directory: WorkspaceDirectory): void;
