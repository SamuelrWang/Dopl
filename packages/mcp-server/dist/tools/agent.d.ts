/**
 * `dopl_agent` — agent identities (roles of the user) that agents launch from; deletion is app-only.
 * "Agents" also names running sessions (INVARIANTS §5A): those are `dopl_channel(op="status")`, not this tool.
 */
import type { DoplClient } from "@dopl/client";
import { type CallerIdentity } from "./identity.js";
import { type RegisterTool } from "./respond.js";
import type { WorkspaceDirectory } from "../workspace-directory.js";
export declare function registerAgentTools(register: RegisterTool, client: DoplClient, caller: CallerIdentity | undefined, directory: WorkspaceDirectory): void;
