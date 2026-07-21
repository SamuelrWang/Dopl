/**
 * `dopl_workflow` mutating op handlers: create, update, set_graph, the
 * incremental node/edge ops (add_node/update_node/remove_node/connect/
 * disconnect), set_cluster, and restore_workflow (recovery). Each maps a
 * backend 404 to actionable "no such workflow/step/edge" guidance. Routed
 * from the registrar in workflow.ts.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare function opCreate(client: DoplClient, name: string): Promise<ToolResponse>;
export declare function opUpdate(client: DoplClient, slug: string, name: string | undefined, description: string | undefined): Promise<ToolResponse>;
export declare function opSetGraph(client: DoplClient, slug: string, graph: {
    nodes: Array<{
        ref?: string;
    }>;
    edges: Array<{
        from: string;
        to: string;
        condition?: string;
    }>;
}): Promise<ToolResponse>;
export declare function opAddNode(client: DoplClient, slug: string, node: Record<string, unknown>, connectFrom: string | undefined): Promise<ToolResponse>;
export declare function opUpdateNode(client: DoplClient, slug: string, nodeId: string, node: Record<string, unknown>): Promise<ToolResponse>;
export declare function opRemoveNode(client: DoplClient, slug: string, nodeId: string): Promise<ToolResponse>;
export declare function opConnect(client: DoplClient, slug: string, from: string, to: string, condition: string | undefined): Promise<ToolResponse>;
export declare function opDisconnect(client: DoplClient, slug: string, from: string, to: string): Promise<ToolResponse>;
export declare function opSetCluster(client: DoplClient, slug: string, cluster: string | undefined): Promise<ToolResponse>;
export declare function opRestoreWorkflow(client: DoplClient, slug: string): Promise<ToolResponse>;
