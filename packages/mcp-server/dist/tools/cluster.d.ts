/**
 * `dopl_cluster` + `dopl_cluster_admin` — cluster read/non-destructive writes
 * and the separately permission-gated destructive cluster operations.
 *
 * Clusters are containers for attached knowledge bases + skills.
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerClusterTools(register: RegisterTool, client: DoplClient): void;
