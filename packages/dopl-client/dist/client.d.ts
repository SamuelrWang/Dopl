import type { WorkspaceListItem, ClusterDetail, ClusterRow, WorkflowRow, WorkflowTrashRow, WorkflowDetail, WorkflowGraphSpec, WorkflowNodeInput, ResolvedWorkspace } from "./types.js";
import { DoplTransport } from "./transport.js";
import type { KnowledgeBase, KnowledgeBaseCreateInput, KnowledgeBaseUpdateInput, KnowledgeDirListing, KnowledgeEntry, KnowledgeFolder, KnowledgePathOpResult, KnowledgeSearchHit, KnowledgeTrashSnapshot, KnowledgeTreeSnapshot, KnowledgeWriteFileInput, KnowledgeWriteFileResult } from "./knowledge-types.js";
import type { CreateSkillInput, UpdateSkillPatch as SkillUpdatePatch } from "./skills.js";
import type { ResolvedSkill, Skill, SkillFile, SkillWriteFileResult } from "./skill-types.js";
import type { OntologyCluster, OntologyClusterCreateInput, OntologyClusterPatch, OntologyObject, OntologyObjectCreateInput, OntologyObjectPatch, OntologySnapshot } from "./ontology-types.js";
import type { Chat, ChatDetail, ChatExportInput, ChatFolder, ChatFolderUpdateInput, ChatList, ChatMessageInput, ChatUpdateInput, TrashedChat } from "./chat-types.js";
import type { AccessMatrix, EffectiveAccessRow, MyAccess, MyMembership, WorkspaceMember, WorkspaceTeam } from "./member-types.js";
import { ChannelAgentsClient } from "./client-channel-agents.js";
import type { AwaitMessagesOptions, AwaitResult, Channel, ChannelCreateInput, ChannelMember, ChannelMessage, ChannelMessageInput, ChannelMessagePosted, ChannelThread, ChannelThreadClosed, ChannelThreadCreated, ChannelThreadCreateInput, ChannelThreadDetail, ReadMessagesOptions, ThreadMode, ThreadOutcome } from "./channel-types.js";
export type { DoplTransportOptions as DoplClientOptions } from "./transport.js";
export { parseRetryAfter } from "./retry.js";
export declare class DoplClient extends ChannelAgentsClient {
    constructor(baseUrl: string, apiKey: string, opts?: ConstructorParameters<typeof DoplTransport>[2]);
    getBaseUrl(): string;
    /**
     * Active canvas (workspace) for this client. When set, every request
     * carries an `X-Workspace-Id` header so the server scopes data
     * accordingly. Set null to clear.
     */
    setWorkspaceId(workspaceId: string | null): void;
    getWorkspaceId(): string | null;
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
    /** Workspace-scoped trash — every soft-deleted workflow the caller may see. */
    listWorkflowTrash(): Promise<{
        workflows: WorkflowTrashRow[];
    }>;
    /** Restore a soft-deleted workflow (recovery, not deletion). */
    restoreWorkflow(idOrSlug: string): Promise<WorkflowRow>;
    setWorkflowGraph(idOrSlug: string, spec: WorkflowGraphSpec): Promise<void>;
    addWorkflowNode(idOrSlug: string, node: WorkflowNodeInput & {
        connect_from?: string;
    }): Promise<{
        node_id: string;
    }>;
    updateWorkflowNode(idOrSlug: string, nodeId: string, patch: Partial<WorkflowNodeInput>): Promise<void>;
    removeWorkflowNode(idOrSlug: string, nodeId: string): Promise<void>;
    connectWorkflow(idOrSlug: string, from: string, to: string, condition?: string): Promise<void>;
    disconnectWorkflow(idOrSlug: string, from: string, to: string): Promise<void>;
    listWorkspaces(): Promise<{
        workspaces: WorkspaceListItem[];
    }>;
    getWorkspace(slug: string): Promise<ResolvedWorkspace>;
    /**
     * Resolve the active workspace — the one currently set on the transport
     * via `setWorkspaceId(...)` or `X-Workspace-Id` — via `GET
     * /api/workspaces/me`. Header-less resolution now depends on the caller's
     * membership count (exactly one auto-targets; 0 or 2+ → 400
     * WORKSPACE_REQUIRED). The MCP server boots off `listWorkspaces()` instead,
     * so this is no longer on the boot path.
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
    deleteCluster(slug: string): Promise<void>;
    listKbBases(): Promise<KnowledgeBase[]>;
    getKbBase(baseId: string): Promise<KnowledgeBase>;
    getKbTree(baseId: string, opts?: {
        entryLimit?: number;
        entryCursor?: string;
    }): Promise<KnowledgeTreeSnapshot>;
    createKbBase(input: KnowledgeBaseCreateInput): Promise<KnowledgeBase>;
    updateKbBase(baseId: string, patch: KnowledgeBaseUpdateInput): Promise<KnowledgeBase>;
    deleteKbBase(baseId: string): Promise<void>;
    restoreKbBase(baseId: string): Promise<KnowledgeBase>;
    readKbFileByPath(baseId: string, path: string): Promise<KnowledgeEntry>;
    writeKbFileByPath(baseId: string, path: string, input?: KnowledgeWriteFileInput, expectedVersion?: string | null): Promise<KnowledgeWriteFileResult>;
    listKbDirByPath(baseId: string, path?: string): Promise<KnowledgeDirListing>;
    createKbFolderByPath(baseId: string, path: string, description?: string | null): Promise<KnowledgeFolder>;
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
    createOntologyCluster(input: OntologyClusterCreateInput): Promise<OntologyCluster>;
    updateOntologyCluster(clusterId: string, patch: OntologyClusterPatch): Promise<OntologyCluster>;
    deleteOntologyCluster(clusterId: string): Promise<void>;
    restoreOntologyCluster(clusterRef: string): Promise<OntologyCluster>;
    createOntologyObject(input: OntologyObjectCreateInput): Promise<OntologyObject>;
    updateOntologyObject(objectId: string, patch: OntologyObjectPatch, expectedVersion?: string): Promise<OntologyObject>;
    deleteOntologyObject(objectId: string): Promise<void>;
    claimOntologyAnchor(objectId: string): Promise<OntologyObject>;
    listChats(): Promise<ChatList>;
    getChat(chatId: string): Promise<ChatDetail>;
    exportChat(input: ChatExportInput): Promise<ChatDetail>;
    appendChatMessages(chatId: string, messages: ChatMessageInput[]): Promise<ChatDetail>;
    updateChat(chatId: string, patch: ChatUpdateInput): Promise<Chat>;
    deleteChat(chatId: string): Promise<void>;
    restoreChat(chatId: string): Promise<Chat>;
    listChatsTrash(): Promise<TrashedChat[]>;
    listChatFolders(): Promise<ChatFolder[]>;
    createChatFolder(name: string): Promise<ChatFolder>;
    updateChatFolder(folderId: string, patch: ChatFolderUpdateInput): Promise<ChatFolder>;
    deleteChatFolder(folderId: string): Promise<void>;
    getMyMembership(): Promise<MyMembership>;
    listWorkspaceMembers(): Promise<WorkspaceMember[]>;
    listWorkspaceTeams(): Promise<WorkspaceTeam[]>;
    getAccessMatrix(): Promise<AccessMatrix>;
    getMyAccess(): Promise<MyAccess>;
    getMemberAccess(targetUserId: string): Promise<EffectiveAccessRow[]>;
    listChannels(opts?: {
        includeArchived?: boolean;
    }): Promise<Channel[]>;
    getChannel(channelId: string): Promise<Channel>;
    createChannel(input: ChannelCreateInput): Promise<Channel>;
    listChannelMembers(channelId: string): Promise<ChannelMember[]>;
    inviteToChannel(channelId: string, userId: string): Promise<ChannelMember>;
    readChannelMessages(channelId: string, opts?: ReadMessagesOptions): Promise<ChannelMessage[]>;
    postChannelMessage(channelId: string, input: ChannelMessageInput): Promise<ChannelMessagePosted>;
    awaitChannelMessages(channelId: string, opts: AwaitMessagesOptions): Promise<AwaitResult>;
    listChannelThreads(channelId: string): Promise<ChannelThreadDetail[]>;
    getChannelThread(channelId: string, threadId: string): Promise<ChannelThreadDetail>;
    createChannelThread(channelId: string, input: ChannelThreadCreateInput): Promise<ChannelThreadCreated>;
    closeChannelThread(channelId: string, threadId: string, input: {
        outcome: ThreadOutcome;
        summary?: string;
    }): Promise<ChannelThreadClosed>;
    setChannelThreadMode(channelId: string, threadId: string, input: {
        mode: ThreadMode;
    }): Promise<ChannelThread>;
    listSkills(): Promise<Skill[]>;
    getSkill(slug: string): Promise<ResolvedSkill>;
    createSkill(input: CreateSkillInput): Promise<{
        skill: Skill;
        primaryFile: SkillFile;
    }>;
    updateSkill(slug: string, patch: SkillUpdatePatch): Promise<Skill>;
    deleteSkill(slug: string): Promise<void>;
    readSkillBody(slug: string): Promise<SkillFile>;
    writeSkillBody(slug: string, body: string, expectedVersion?: string | null): Promise<SkillWriteFileResult>;
}
