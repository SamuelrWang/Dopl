import type {
  WorkspaceListItem,
  ClusterDetail,
  ClusterRow,
  WorkflowRow,
  WorkflowTrashRow,
  WorkflowDetail,
  WorkflowGraphSpec,
  WorkflowNodeInput,
  ResolvedWorkspace,
} from "./types.js";
import { DoplTransport } from "./transport.js";
import * as kb from "./knowledge.js";
import type {
  KnowledgeBase,
  KnowledgeBaseCreateInput,
  KnowledgeBaseUpdateInput,
  KnowledgeDirListing,
  KnowledgeEntry,
  KnowledgeFolder,
  KnowledgePathOpResult,
  KnowledgeSearchHit,
  KnowledgeTrashSnapshot,
  KnowledgeTreeSnapshot,
  KnowledgeWriteFileInput,
  KnowledgeWriteFileResult,
} from "./knowledge-types.js";
import * as skills from "./skills.js";
import type {
  CreateSkillInput,
  UpdateSkillPatch as SkillUpdatePatch,
} from "./skills.js";
import type {
  ResolvedSkill,
  Skill,
  SkillFile,
  SkillWriteFileResult,
} from "./skill-types.js";
import * as ontology from "./ontology.js";
import type {
  OntologyCluster,
  OntologyClusterCreateInput,
  OntologyClusterPatch,
  OntologyObject,
  OntologyObjectCreateInput,
  OntologyObjectPatch,
  OntologySnapshot,
} from "./ontology-types.js";
import * as chats from "./chats.js";
import type {
  Chat,
  ChatDetail,
  ChatExportInput,
  ChatFolder,
  ChatFolderUpdateInput,
  ChatList,
  ChatMessageInput,
  ChatUpdateInput,
  TrashedChat,
} from "./chat-types.js";
import * as members from "./members.js";
import type {
  AccessMatrix,
  EffectiveAccessRow,
  MyAccess,
  MyMembership,
  WorkspaceMember,
  WorkspaceTeam,
} from "./member-types.js";
import * as channel from "./channel.js";
import type {
  AwaitMessagesOptions,
  AwaitResult,
  Channel,
  ChannelCreateInput,
  ChannelMember,
  ChannelMessage,
  ChannelMessageInput,
  ChannelThread,
  ChannelThreadClosed,
  ChannelThreadCreated,
  ChannelThreadCreateInput,
  ReadMessagesOptions,
  ThreadMode,
  ThreadOutcome,
} from "./channel-types.js";

export type { DoplTransportOptions as DoplClientOptions } from "./transport.js";
export { parseRetryAfter } from "./retry.js";

export class DoplClient {
  private transport: DoplTransport;

  constructor(
    baseUrl: string,
    apiKey: string,
    opts: ConstructorParameters<typeof DoplTransport>[2] = {}
  ) {
    this.transport = new DoplTransport(baseUrl, apiKey, opts);
  }

  getBaseUrl(): string {
    return this.transport.getBaseUrl();
  }

  /**
   * Active canvas (workspace) for this client. When set, every request
   * carries an `X-Workspace-Id` header so the server scopes data
   * accordingly. Set null to clear.
   */
  setWorkspaceId(workspaceId: string | null): void {
    this.transport.setWorkspaceId(workspaceId);
  }

  getWorkspaceId(): string | null {
    return this.transport.getWorkspaceId();
  }

  async createCluster(name: string): Promise<ClusterRow> {
    return this.transport.request<ClusterRow>("/api/clusters", {
      method: "POST",
      toolName: "canvas_create_cluster",
      body: { name },
    });
  }

  async listClusters(): Promise<{ clusters: ClusterRow[] }> {
    return this.transport.request<{ clusters: ClusterRow[] }>("/api/clusters", {
      toolName: "list_clusters",
    });
  }

  async getCluster(slug: string): Promise<ClusterDetail> {
    return this.transport.request<ClusterDetail>(
      `/api/clusters/${encodeURIComponent(slug)}`,
      { toolName: "get_cluster" }
    );
  }

  // ── Workflows ────────────────────────────────────────────────────
  async listWorkflows(): Promise<{ workflows: WorkflowRow[] }> {
    return this.transport.request<{ workflows: WorkflowRow[] }>(
      "/api/workflows",
      { toolName: "list_workflows" }
    );
  }

  async getWorkflow(idOrSlug: string): Promise<WorkflowDetail> {
    return this.transport.request<WorkflowDetail>(
      `/api/workflows/${encodeURIComponent(idOrSlug)}`,
      { toolName: "get_workflow" }
    );
  }

  async createWorkflow(name: string): Promise<WorkflowRow> {
    return this.transport.request<WorkflowRow>("/api/workflows", {
      method: "POST",
      toolName: "create_workflow",
      body: { name },
    });
  }

  async updateWorkflow(
    idOrSlug: string,
    updates: {
      name?: string;
      description?: string | null;
      /** Cluster UUID to group this workflow under, or null to ungroup. */
      clusterId?: string | null;
    }
  ): Promise<WorkflowRow> {
    return this.transport.request<WorkflowRow>(
      `/api/workflows/${encodeURIComponent(idOrSlug)}`,
      { method: "PATCH", toolName: "update_workflow", body: updates }
    );
  }

  async deleteWorkflow(idOrSlug: string): Promise<void> {
    await this.transport.requestNoContent(
      `/api/workflows/${encodeURIComponent(idOrSlug)}`,
      "DELETE",
      "delete_workflow"
    );
  }

  /** Workspace-scoped trash — every soft-deleted workflow the caller may see. */
  async listWorkflowTrash(): Promise<{ workflows: WorkflowTrashRow[] }> {
    return this.transport.request<{ workflows: WorkflowTrashRow[] }>(
      "/api/workflows/trash",
      { toolName: "list_workflow_trash" }
    );
  }

  /** Restore a soft-deleted workflow (recovery, not deletion). */
  async restoreWorkflow(idOrSlug: string): Promise<WorkflowRow> {
    return this.transport.request<WorkflowRow>(
      `/api/workflows/${encodeURIComponent(idOrSlug)}/restore`,
      { method: "POST", toolName: "restore_workflow", body: {} }
    );
  }

  // ── Workflow graph authoring ──────────────────────────────────────
  async setWorkflowGraph(
    idOrSlug: string,
    spec: WorkflowGraphSpec
  ): Promise<void> {
    await this.transport.requestNoContent(
      `/api/workflows/${encodeURIComponent(idOrSlug)}/graph`,
      "POST",
      "set_workflow_graph",
      spec
    );
  }

  async addWorkflowNode(
    idOrSlug: string,
    node: WorkflowNodeInput & { connect_from?: string }
  ): Promise<{ node_id: string }> {
    return this.transport.request<{ node_id: string }>(
      `/api/workflows/${encodeURIComponent(idOrSlug)}/nodes`,
      { method: "POST", toolName: "add_workflow_node", body: node }
    );
  }

  async updateWorkflowNode(
    idOrSlug: string,
    nodeId: string,
    patch: Partial<WorkflowNodeInput>
  ): Promise<void> {
    await this.transport.requestNoContent(
      `/api/workflows/${encodeURIComponent(idOrSlug)}/nodes/${encodeURIComponent(nodeId)}`,
      "PATCH",
      "update_workflow_node",
      patch
    );
  }

  async removeWorkflowNode(idOrSlug: string, nodeId: string): Promise<void> {
    await this.transport.requestNoContent(
      `/api/workflows/${encodeURIComponent(idOrSlug)}/nodes/${encodeURIComponent(nodeId)}`,
      "DELETE",
      "remove_workflow_node"
    );
  }

  async connectWorkflow(
    idOrSlug: string,
    from: string,
    to: string,
    condition?: string
  ): Promise<void> {
    await this.transport.requestNoContent(
      `/api/workflows/${encodeURIComponent(idOrSlug)}/edges`,
      "POST",
      "connect_workflow",
      { from, to, condition }
    );
  }

  async disconnectWorkflow(
    idOrSlug: string,
    from: string,
    to: string
  ): Promise<void> {
    await this.transport.requestNoContent(
      `/api/workflows/${encodeURIComponent(idOrSlug)}/edges`,
      "DELETE",
      "disconnect_workflow",
      { from, to }
    );
  }

  // ── Workspaces ────────────────────────────────────────────────────

  async listWorkspaces(): Promise<{ workspaces: WorkspaceListItem[] }> {
    return this.transport.request<{ workspaces: WorkspaceListItem[] }>(
      "/api/workspaces",
      { toolName: "list_workspaces" }
    );
  }

  async getWorkspace(slug: string): Promise<ResolvedWorkspace> {
    return this.transport.request<ResolvedWorkspace>(
      `/api/workspaces/${encodeURIComponent(slug)}`,
      { toolName: "get_workspace" }
    );
  }

  /**
   * Resolve the active workspace — the one currently set on the transport
   * via `setWorkspaceId(...)` or `X-Workspace-Id` — via `GET
   * /api/workspaces/me`. Header-less resolution now depends on the caller's
   * membership count (exactly one auto-targets; 0 or 2+ → 400
   * WORKSPACE_REQUIRED). The MCP server boots off `listWorkspaces()` instead,
   * so this is no longer on the boot path.
   */
  async getActiveWorkspace(): Promise<ResolvedWorkspace> {
    return this.transport.request<ResolvedWorkspace>("/api/workspaces/me", {
      toolName: "get_active_workspace",
    });
  }

  async pingMcpStatus(): Promise<{ is_admin: boolean; user_id: string | null }> {
    const res = await this.transport.request<{
      ok: boolean;
      is_admin?: boolean;
      user_id?: string;
    }>("/api/user/mcp-status", {
      method: "POST",
      toolName: "_mcp_status_ping",
      body: {},
    });
    return {
      is_admin: res.is_admin === true,
      user_id: typeof res.user_id === "string" ? res.user_id : null,
    };
  }

  async updateCluster(
    slug: string,
    updates: { name?: string; description?: string | null }
  ): Promise<ClusterRow> {
    return this.transport.request<ClusterRow>(
      `/api/clusters/${encodeURIComponent(slug)}`,
      {
        method: "PATCH",
        toolName: "update_cluster",
        body: updates,
      }
    );
  }

  async deleteCluster(slug: string): Promise<void> {
    await this.transport.requestNoContent(
      `/api/clusters/${encodeURIComponent(slug)}`,
      "DELETE",
      "delete_cluster"
    );
  }

  // ─── User knowledge bases (Item 4) ────────────────────────────────
  // User-authored, editable knowledge bases. Path-based methods accept
  // a base id and a "/"-separated path; the server resolves to
  // folder/entry rows.

  listKbBases(): Promise<KnowledgeBase[]> {
    return kb.listKbBases(this.transport);
  }

  getKbBase(baseId: string): Promise<KnowledgeBase> {
    return kb.getKbBase(this.transport, baseId);
  }

  getKbTree(
    baseId: string,
    opts?: { entryLimit?: number; entryCursor?: string }
  ): Promise<KnowledgeTreeSnapshot> {
    return kb.getKbTree(this.transport, baseId, opts);
  }

  createKbBase(input: KnowledgeBaseCreateInput): Promise<KnowledgeBase> {
    return kb.createKbBase(this.transport, input);
  }

  updateKbBase(
    baseId: string,
    patch: KnowledgeBaseUpdateInput
  ): Promise<KnowledgeBase> {
    return kb.updateKbBase(this.transport, baseId, patch);
  }

  deleteKbBase(baseId: string): Promise<void> {
    return kb.deleteKbBase(this.transport, baseId);
  }

  restoreKbBase(baseId: string): Promise<KnowledgeBase> {
    return kb.restoreKbBase(this.transport, baseId);
  }

  readKbFileByPath(baseId: string, path: string): Promise<KnowledgeEntry> {
    return kb.readKbFileByPath(this.transport, baseId, path);
  }

  writeKbFileByPath(
    baseId: string,
    path: string,
    input: KnowledgeWriteFileInput = {},
    expectedVersion?: string | null
  ): Promise<KnowledgeWriteFileResult> {
    return kb.writeKbFileByPath(
      this.transport,
      baseId,
      path,
      input,
      expectedVersion
    );
  }

  listKbDirByPath(
    baseId: string,
    path: string = ""
  ): Promise<KnowledgeDirListing> {
    return kb.listKbDirByPath(this.transport, baseId, path);
  }

  createKbFolderByPath(
    baseId: string,
    path: string,
    description?: string | null
  ): Promise<KnowledgeFolder> {
    return kb.createKbFolderByPath(this.transport, baseId, path, description);
  }

  deleteKbByPath(
    baseId: string,
    path: string
  ): Promise<KnowledgePathOpResult> {
    return kb.deleteKbByPath(this.transport, baseId, path);
  }

  moveKbByPath(
    baseId: string,
    fromPath: string,
    toPath: string
  ): Promise<KnowledgePathOpResult> {
    return kb.moveKbByPath(this.transport, baseId, fromPath, toPath);
  }

  listKbTrash(baseId?: string): Promise<KnowledgeTrashSnapshot> {
    return kb.listKbTrash(this.transport, baseId);
  }

  restoreKbFolder(folderId: string): Promise<KnowledgeFolder> {
    return kb.restoreKbFolder(this.transport, folderId);
  }

  restoreKbEntry(entryId: string): Promise<KnowledgeEntry> {
    return kb.restoreKbEntry(this.transport, entryId);
  }

  searchKb(
    query: string,
    opts: { baseSlug?: string; limit?: number } = {}
  ): Promise<KnowledgeSearchHit[]> {
    return kb.searchKb(this.transport, query, opts);
  }

  // ─── Ontology ────────────────────────────────────────────────────────

  getOntology(): Promise<OntologySnapshot> {
    return ontology.getOntology(this.transport);
  }

  getOntologyAnchor(): Promise<OntologyObject | null> {
    return ontology.getOntologyAnchor(this.transport);
  }

  createOntologyCluster(input: OntologyClusterCreateInput): Promise<OntologyCluster> {
    return ontology.createOntologyCluster(this.transport, input);
  }

  updateOntologyCluster(clusterId: string, patch: OntologyClusterPatch): Promise<OntologyCluster> {
    return ontology.updateOntologyCluster(this.transport, clusterId, patch);
  }

  deleteOntologyCluster(clusterId: string): Promise<void> {
    return ontology.deleteOntologyCluster(this.transport, clusterId);
  }

  restoreOntologyCluster(clusterRef: string): Promise<OntologyCluster> {
    return ontology.restoreOntologyCluster(this.transport, clusterRef);
  }

  createOntologyObject(input: OntologyObjectCreateInput): Promise<OntologyObject> {
    return ontology.createOntologyObject(this.transport, input);
  }

  updateOntologyObject(
    objectId: string,
    patch: OntologyObjectPatch,
    expectedVersion?: string
  ): Promise<OntologyObject> {
    return ontology.updateOntologyObject(this.transport, objectId, patch, expectedVersion);
  }

  deleteOntologyObject(objectId: string): Promise<void> {
    return ontology.deleteOntologyObject(this.transport, objectId);
  }

  claimOntologyAnchor(objectId: string): Promise<OntologyObject> {
    return ontology.claimOntologyAnchor(this.transport, objectId);
  }

  // ─── Chats (archive) ───────────────────────────────────────────────
  // Agent-exported conversation archive. Reads return the caller's own
  // chats plus workspace-public ones; writes are owner-scoped
  // server-side.

  listChats(): Promise<ChatList> {
    return chats.listChats(this.transport);
  }

  getChat(chatId: string): Promise<ChatDetail> {
    return chats.getChat(this.transport, chatId);
  }

  exportChat(input: ChatExportInput): Promise<ChatDetail> {
    return chats.exportChat(this.transport, input);
  }

  appendChatMessages(
    chatId: string,
    messages: ChatMessageInput[]
  ): Promise<ChatDetail> {
    return chats.appendChatMessages(this.transport, chatId, messages);
  }

  updateChat(chatId: string, patch: ChatUpdateInput): Promise<Chat> {
    return chats.updateChat(this.transport, chatId, patch);
  }

  deleteChat(chatId: string): Promise<void> {
    return chats.deleteChat(this.transport, chatId);
  }

  restoreChat(chatId: string): Promise<Chat> {
    return chats.restoreChat(this.transport, chatId);
  }

  listChatsTrash(): Promise<TrashedChat[]> {
    return chats.listChatsTrash(this.transport);
  }

  listChatFolders(): Promise<ChatFolder[]> {
    return chats.listChatFolders(this.transport);
  }

  createChatFolder(name: string): Promise<ChatFolder> {
    return chats.createChatFolder(this.transport, name);
  }

  updateChatFolder(
    folderId: string,
    patch: ChatFolderUpdateInput
  ): Promise<ChatFolder> {
    return chats.updateChatFolder(this.transport, folderId, patch);
  }

  deleteChatFolder(folderId: string): Promise<void> {
    return chats.deleteChatFolder(this.transport, folderId);
  }

  // ─── Members / teams / access (READ-ONLY) ──────────────────────────
  // Membership, team, and access changes are human decisions made in
  // the web UI — this client deliberately exposes no write path.

  getMyMembership(): Promise<MyMembership> {
    return members.getMyMembership(this.transport);
  }

  listWorkspaceMembers(): Promise<WorkspaceMember[]> {
    return members.listMembers(this.transport);
  }

  listWorkspaceTeams(): Promise<WorkspaceTeam[]> {
    return members.listTeams(this.transport);
  }

  getAccessMatrix(): Promise<AccessMatrix> {
    return members.getAccessMatrix(this.transport);
  }

  getMyAccess(): Promise<MyAccess> {
    return members.getMyAccess(this.transport);
  }

  getMemberAccess(targetUserId: string): Promise<EffectiveAccessRow[]> {
    return members.getMemberAccess(this.transport, targetUserId);
  }

  // ─── Channels ──────────────────────────────────────────────────────
  // Cross-user, agent-to-agent collaboration threads. Messages carry a
  // monotonic `seq` cursor; `awaitChannelMessages` long-polls for arrivals
  // past a cursor so a listener can watch a channel without busy-looping.

  listChannels(opts?: { includeArchived?: boolean }): Promise<Channel[]> {
    return channel.listChannels(this.transport, opts);
  }

  getChannel(channelId: string): Promise<Channel> {
    return channel.getChannel(this.transport, channelId);
  }

  createChannel(input: ChannelCreateInput): Promise<Channel> {
    return channel.createChannel(this.transport, input);
  }

  listChannelMembers(channelId: string): Promise<ChannelMember[]> {
    return channel.listChannelMembers(this.transport, channelId);
  }

  inviteToChannel(channelId: string, userId: string): Promise<ChannelMember> {
    return channel.inviteToChannel(this.transport, channelId, userId);
  }

  readChannelMessages(
    channelId: string,
    opts?: ReadMessagesOptions
  ): Promise<ChannelMessage[]> {
    return channel.readMessages(this.transport, channelId, opts);
  }

  postChannelMessage(
    channelId: string,
    input: ChannelMessageInput
  ): Promise<ChannelMessage> {
    return channel.postMessage(this.transport, channelId, input);
  }

  awaitChannelMessages(
    channelId: string,
    opts: AwaitMessagesOptions
  ): Promise<AwaitResult> {
    return channel.awaitMessages(this.transport, channelId, opts);
  }

  listChannelThreads(channelId: string): Promise<ChannelThread[]> {
    return channel.listChannelThreads(this.transport, channelId);
  }

  getChannelThread(channelId: string, threadId: string): Promise<ChannelThread> {
    return channel.getChannelThread(this.transport, channelId, threadId);
  }

  createChannelThread(
    channelId: string,
    input: ChannelThreadCreateInput
  ): Promise<ChannelThreadCreated> {
    return channel.createChannelThread(this.transport, channelId, input);
  }

  closeChannelThread(
    channelId: string,
    threadId: string,
    input: { outcome: ThreadOutcome; summary?: string }
  ): Promise<ChannelThreadClosed> {
    return channel.closeChannelThread(this.transport, channelId, threadId, input);
  }

  setChannelThreadMode(
    channelId: string,
    threadId: string,
    input: { mode: ThreadMode }
  ): Promise<ChannelThread> {
    return channel.setChannelThreadMode(this.transport, channelId, threadId, input);
  }

  // ─── Skills ─────────────────────────────────────────────────────────
  // Read paths are unrestricted; write paths are gated server-side by
  // the per-skill `agent_write_enabled` toggle for API-key (agent)
  // callers. Skills are single-file: one SKILL.md procedure body.

  listSkills(): Promise<Skill[]> {
    return skills.listSkills(this.transport);
  }

  getSkill(slug: string): Promise<ResolvedSkill> {
    return skills.getSkill(this.transport, slug);
  }

  createSkill(
    input: CreateSkillInput
  ): Promise<{ skill: Skill; primaryFile: SkillFile }> {
    return skills.createSkill(this.transport, input);
  }

  updateSkill(slug: string, patch: SkillUpdatePatch): Promise<Skill> {
    return skills.updateSkill(this.transport, slug, patch);
  }

  deleteSkill(slug: string): Promise<void> {
    return skills.deleteSkill(this.transport, slug);
  }

  readSkillBody(slug: string): Promise<SkillFile> {
    return skills.readSkillBody(this.transport, slug);
  }

  writeSkillBody(
    slug: string,
    body: string,
    expectedVersion?: string | null
  ): Promise<SkillWriteFileResult> {
    return skills.writeSkillBody(this.transport, slug, body, expectedVersion);
  }
}
