import type { CanvasPanel, WorkspaceListItem, ClusterDetail, ClusterRow, WorkflowRow, WorkflowDetail, WorkflowGraphSpec, WorkflowNodeInput, Pack, PackFile, PackFileMeta, ResolvedWorkspace } from "./types.js";
import { DoplTransport } from "./transport.js";
import type { KnowledgeBase, KnowledgeBaseCreateInput, KnowledgeBaseUpdateInput, KnowledgeDirListing, KnowledgeEntry, KnowledgeFolder, KnowledgePathOpResult, KnowledgeSearchHit, KnowledgeTrashSnapshot, KnowledgeTreeSnapshot, KnowledgeWriteFileInput, KnowledgeWriteFileResult } from "./knowledge-types.js";
import type { CreateSkillInput, UpdateSkillPatch as SkillUpdatePatch } from "./skills.js";
import type { ResolvedSkill, Skill, SkillFile, SkillWriteFileResult } from "./skill-types.js";
import type { OntologyObject, OntologySnapshot } from "./ontology-types.js";
export type { DoplTransportOptions as DoplClientOptions } from "./transport.js";
export { parseRetryAfter } from "./retry.js";
export declare class DoplClient {
    private transport;
    constructor(baseUrl: string, apiKey: string, opts?: ConstructorParameters<typeof DoplTransport>[2]);
    getBaseUrl(): string;
    /**
     * Active canvas (workspace) for this client. When set, every request
     * carries an `X-Workspace-Id` header so the server scopes data
     * accordingly. Set null to clear.
     */
    setWorkspaceId(workspaceId: string | null): void;
    getWorkspaceId(): string | null;
    listCanvasPanels(): Promise<CanvasPanel[]>;
    createCluster(name: string): Promise<ClusterRow>;
    listClusters(): Promise<{
        clusters: ClusterRow[];
    }>;
    getCluster(slug: string): Promise<ClusterDetail>;
    listWorkflows(): Promise<{
        workflows: WorkflowRow[];
    }>;
    getWorkflow(idOrSlug: string): Promise<WorkflowDetail>;
    createWorkflow(name: string): Promise<WorkflowRow>;
    updateWorkflow(idOrSlug: string, updates: {
        name?: string;
        description?: string | null;
        /** Cluster UUID to group this workflow under, or null to ungroup. */
        clusterId?: string | null;
    }): Promise<WorkflowRow>;
    deleteWorkflow(idOrSlug: string): Promise<void>;
    setWorkflowGraph(idOrSlug: string, spec: WorkflowGraphSpec): Promise<void>;
    addWorkflowNode(idOrSlug: string, node: WorkflowNodeInput & {
        connect_from?: string;
    }): Promise<{
        node_id: string;
    }>;
    updateWorkflowNode(idOrSlug: string, nodeId: string, patch: Partial<WorkflowNodeInput>): Promise<void>;
    removeWorkflowNode(idOrSlug: string, nodeId: string): Promise<void>;
    connectWorkflow(idOrSlug: string, from: string, to: string): Promise<void>;
    disconnectWorkflow(idOrSlug: string, from: string, to: string): Promise<void>;
    listWorkspaces(): Promise<{
        workspaces: WorkspaceListItem[];
    }>;
    getWorkspace(slug: string): Promise<ResolvedWorkspace>;
    /**
     * Resolve the active workspace — the one currently set on the transport
     * via `setWorkspaceId(...)` or `X-Workspace-Id`. Used by the MCP server's
     * startup handshake to confirm the requested workspace exists and the
     * caller is a member.
     */
    getActiveWorkspace(): Promise<ResolvedWorkspace>;
    pingMcpStatus(): Promise<{
        is_admin: boolean;
        user_id: string | null;
    }>;
    updateCluster(slug: string, updates: {
        name?: string;
        description?: string | null;
    }): Promise<ClusterRow>;
    renameChat(panelId: string, title: string): Promise<void>;
    deleteCluster(slug: string): Promise<void>;
    listPacks(): Promise<{
        packs: Pack[];
    }>;
    kbList(pack: string, opts?: {
        category?: string;
        limit?: number;
    }): Promise<{
        pack_id: string;
        files: PackFileMeta[];
    }>;
    kbGet(pack: string, path: string): Promise<{
        file: PackFile;
    }>;
    listKbBases(): Promise<KnowledgeBase[]>;
    getKbBase(baseId: string): Promise<KnowledgeBase>;
    getKbTree(baseId: string): Promise<KnowledgeTreeSnapshot>;
    createKbBase(input: KnowledgeBaseCreateInput): Promise<KnowledgeBase>;
    updateKbBase(baseId: string, patch: KnowledgeBaseUpdateInput): Promise<KnowledgeBase>;
    deleteKbBase(baseId: string): Promise<void>;
    restoreKbBase(baseId: string): Promise<KnowledgeBase>;
    readKbFileByPath(baseId: string, path: string): Promise<KnowledgeEntry>;
    writeKbFileByPath(baseId: string, path: string, input?: KnowledgeWriteFileInput, expectedVersion?: string | null): Promise<KnowledgeWriteFileResult>;
    listKbDirByPath(baseId: string, path?: string): Promise<KnowledgeDirListing>;
    createKbFolderByPath(baseId: string, path: string): Promise<KnowledgeFolder>;
    deleteKbByPath(baseId: string, path: string): Promise<KnowledgePathOpResult>;
    moveKbByPath(baseId: string, fromPath: string, toPath: string): Promise<KnowledgePathOpResult>;
    listKbTrash(baseId?: string): Promise<KnowledgeTrashSnapshot>;
    restoreKbFolder(folderId: string): Promise<KnowledgeFolder>;
    restoreKbEntry(entryId: string): Promise<KnowledgeEntry>;
    searchKb(query: string, opts?: {
        baseSlug?: string;
        limit?: number;
    }): Promise<KnowledgeSearchHit[]>;
    getOntology(): Promise<OntologySnapshot>;
    getOntologyAnchor(): Promise<OntologyObject | null>;
    listSkills(): Promise<Skill[]>;
    getSkill(slug: string): Promise<ResolvedSkill>;
    createSkill(input: CreateSkillInput): Promise<{
        skill: Skill;
        primaryFile: SkillFile;
    }>;
    updateSkill(slug: string, patch: SkillUpdatePatch): Promise<Skill>;
    deleteSkill(slug: string): Promise<void>;
    listSkillFiles(slug: string): Promise<SkillFile[]>;
    readSkillFile(slug: string, fileName: string): Promise<SkillFile>;
    createSkillFile(slug: string, input: {
        name: string;
        body?: string;
    }): Promise<SkillFile>;
    writeSkillFile(slug: string, fileName: string, body: string, expectedVersion?: string | null): Promise<SkillWriteFileResult>;
    renameSkillFile(slug: string, currentName: string, newName: string): Promise<SkillFile>;
    deleteSkillFile(slug: string, fileName: string): Promise<void>;
}
