/**
 * `dopl_kb` registrar: knowledge bases addressed like a filesystem, reads plus non-destructive writes, routed to the
 * `knowledge-ops-*` modules. There is no delete op — deletion is app-only (`delete-policy.ts`).
 */
import type { DoplClient } from "@dopl/client";
import { type CallerIdentity } from "./identity";
import { type RegisterTool } from "./respond";
import type { WorkspaceDirectory } from "../workspace-directory";
export declare function registerKnowledgeTools(register: RegisterTool, client: DoplClient, caller: CallerIdentity | undefined, directory: WorkspaceDirectory): void;
