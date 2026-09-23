/**
 * `dopl_search`: ranked hits across ten groups (four MCP-native reads + the app search), one scope or (`scope="everywhere"`) every reachable
 * one. The per-scope read is `search-scope.ts › searchScope`; this file renders.
 */
import type { DoplClient } from "@dopl/client";
import type { ChargeCredit } from "../registrar.js";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { type RegisterTool } from "./respond";
/** Without `directory` and `charge` there is no fan-out: `scope="everywhere"` answers (and says it
 *  answered) the single-scope search. */
export declare function registerSearchTool(register: RegisterTool, client: DoplClient, directory?: WorkspaceDirectory, charge?: ChargeCredit): void;
