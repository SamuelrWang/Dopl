/**
 * `dopl_members` — READ-ONLY window onto workspace membership, teams,
 * and access. Mirrors exactly what the caller can see in the web UI at
 * their role; the server enforces every gate (other members' effective
 * access is admin-only, the access matrix is filtered for non-admins).
 *
 * Deliberately has NO write ops and NO admin twin: membership, team,
 * and access changes are human decisions made in the Dopl web UI.
 */
import type { DoplClient } from "@dopl/client";
import { type CallerIdentity } from "./identity";
import { type RegisterTool } from "./respond";
export declare function registerMembersTool(register: RegisterTool, client: DoplClient, 
/**
 * The session's ONE identity record (server.ts). `whoami` used to re-derive
 * the caller from `GET /api/workspaces/me`, whose `userId` is nullable — so
 * when that came back null the op printed a workspace, a role and no
 * identifier, while `dopl_channel` in the same connection was confidently
 * marking "you" off a different id. Defaults to unknown, which renders as
 * unknown.
 */
caller?: CallerIdentity): void;
