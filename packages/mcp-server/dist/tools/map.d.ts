/**
 * `dopl_map` — the compact workspace manifest. One call answers "what
 * exists here and where should I look": knowledge bases, skills and
 * ontologies, names + one-liners only. The routing entry point —
 * call before drilling into any domain tool.
 */
import type { DoplClient } from "@dopl/client";
import { type WorkspaceDirectory } from "../workspace-directory.js";
import { type CallerIdentity } from "./identity";
import { type RegisterTool } from "./respond";
export declare function registerMapTool(register: RegisterTool, client: DoplClient, 
/** 🔒 The boot directory, for the three container nodes above. */
directory: WorkspaceDirectory, caller?: CallerIdentity): void;
