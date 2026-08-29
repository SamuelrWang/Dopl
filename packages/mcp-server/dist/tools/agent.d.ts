/**
 * `dopl_agent` + `dopl_agent_admin` — AGENT TEMPLATES, the persistent agent
 * IDENTITIES a user authors once and launches many times.
 *
 * ⚠ THE NAME IS A DELIBERATE COLLISION, RESOLVED BY SAMUEL (ruling Q7,
 * 2026-08-28). "Agents" already names TWO surfaces — the identities on /home and
 * the RUNNING SESSIONS in a channel's info column (INVARIANTS §5A) — and
 * renaming either needs his word. `dopl_agent` matches the operator's noun and
 * the /home tab; the tool DESCRIPTION carries the disambiguating sentence so an
 * agent reaching for "the agents in this channel" is sent to
 * `dopl_channel(op="read_sessions")` instead of here.
 *
 * Thin registrar: two descriptions + schemas + op routing, delegating to
 *   - `agent-shared.ts`    — the three-answer ref resolution + error mappers
 *   - `agent-ops-read.ts`  — list / get
 *   - `agent-ops-write.ts` — create / update (shelf fence + confirm gate)
 *   - `agent-ops-admin.ts` — the (refused) delete
 * ⚠ The `agent-` prefix is what the parity split-scan groups on.
 */
import type { DoplClient } from "@dopl/client";
import { type CallerIdentity } from "./identity.js";
import { type RegisterTool } from "./respond.js";
export declare function registerAgentTools(register: RegisterTool, client: DoplClient, caller?: CallerIdentity): void;
