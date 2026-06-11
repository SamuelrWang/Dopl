/**
 * `dopl_cluster` + `dopl_cluster_admin` — clusters are non-spatial
 * CONTAINERS that group workflows. KB/skill attachments + the node graph
 * live on the workflows themselves (see dopl_workflow); a cluster only
 * carries a name/description and the list of workflows assigned to it.
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerClusterTools(register: RegisterTool, client: DoplClient): void;
