/**
 * `dopl_search` — one ranked search across the workspace. Knowledge
 * entries use the backend hybrid (embeddings + full-text) search;
 * skills and ontology objects match on their name/trigger metadata.
 * Every hit carries the stable handle for the follow-up read.
 */
import type { DoplClient } from "@dopl/client";
import type { ChargeCredit } from "../registrar.js";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { type RegisterTool } from "./respond";
export declare function registerSearchTool(register: RegisterTool, client: DoplClient, directory?: WorkspaceDirectory, charge?: ChargeCredit): void;
