import type {
  CanvasPanel,
  WorkspaceListItem,
  ClusterDetail,
  ClusterRow,
  WorkflowRow,
  WorkflowDetail,
  WorkflowGraphSpec,
  WorkflowNodeInput,
  Pack,
  PackFile,
  PackFileMeta,
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

  async listCanvasPanels(): Promise<CanvasPanel[]> {
    const res = await this.transport.request<{ panels: CanvasPanel[] }>(
      "/api/canvas/panels",
      { toolName: "canvas_list_panels" }
    );
    return res.panels;
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
    to: string
  ): Promise<void> {
    await this.transport.requestNoContent(
      `/api/workflows/${encodeURIComponent(idOrSlug)}/edges`,
      "POST",
      "connect_workflow",
      { from, to }
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
   * via `setWorkspaceId(...)` or `X-Workspace-Id`. Used by the MCP server's
   * startup handshake to confirm the requested workspace exists and the
   * caller is a member.
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

  async renameChat(panelId: string, title: string): Promise<void> {
    await this.transport.request<unknown>(
      `/api/canvas/panels/${encodeURIComponent(panelId)}`,
      {
        method: "PATCH",
        toolName: "rename_chat",
        body: { title },
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

  async listPacks(): Promise<{ packs: Pack[] }> {
    return this.transport.request<{ packs: Pack[] }>("/api/knowledge/packs", {
      toolName: "kb_list_packs",
    });
  }

  async kbList(
    pack: string,
    opts: { category?: string; limit?: number } = {}
  ): Promise<{ pack_id: string; files: PackFileMeta[] }> {
    const qs = new URLSearchParams();
    if (opts.category) qs.set("category", opts.category);
    if (opts.limit) qs.set("limit", String(opts.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return this.transport.request<{ pack_id: string; files: PackFileMeta[] }>(
      `/api/knowledge/packs/${encodeURIComponent(pack)}/files${suffix}`,
      { toolName: "kb_list" }
    );
  }

  async kbGet(pack: string, path: string): Promise<{ file: PackFile }> {
    return this.transport.request<{ file: PackFile }>(
      `/api/knowledge/packs/${encodeURIComponent(pack)}/file?path=${encodeURIComponent(path)}`,
      { toolName: "kb_get" }
    );
  }

  // ─── User knowledge bases (Item 4) ────────────────────────────────
  // Distinct from Dopl knowledge packs above: these are user-authored,
  // editable knowledge bases. Path-based methods accept a base id and
  // a "/"-separated path; the server resolves to folder/entry rows.

  listKbBases(): Promise<KnowledgeBase[]> {
    return kb.listKbBases(this.transport);
  }

  getKbBase(baseId: string): Promise<KnowledgeBase> {
    return kb.getKbBase(this.transport, baseId);
  }

  getKbTree(baseId: string): Promise<KnowledgeTreeSnapshot> {
    return kb.getKbTree(this.transport, baseId);
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

  createKbFolderByPath(baseId: string, path: string): Promise<KnowledgeFolder> {
    return kb.createKbFolderByPath(this.transport, baseId, path);
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

  // ─── Skills ─────────────────────────────────────────────────────────
  // Read paths are unrestricted; write paths are gated server-side by
  // the per-skill `agent_write_enabled` toggle for API-key (agent)
  // callers. Skills are folders of `.md` files; SKILL.md is the
  // canonical procedure.

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

  listSkillFiles(slug: string): Promise<SkillFile[]> {
    return skills.listSkillFiles(this.transport, slug);
  }

  readSkillFile(slug: string, fileName: string): Promise<SkillFile> {
    return skills.readSkillFile(this.transport, slug, fileName);
  }

  createSkillFile(
    slug: string,
    input: { name: string; body?: string }
  ): Promise<SkillFile> {
    return skills.createSkillFile(this.transport, slug, input);
  }

  writeSkillFile(
    slug: string,
    fileName: string,
    body: string,
    expectedVersion?: string | null
  ): Promise<SkillWriteFileResult> {
    return skills.writeSkillFile(
      this.transport,
      slug,
      fileName,
      body,
      expectedVersion
    );
  }

  renameSkillFile(
    slug: string,
    currentName: string,
    newName: string
  ): Promise<SkillFile> {
    return skills.renameSkillFile(this.transport, slug, currentName, newName);
  }

  deleteSkillFile(slug: string, fileName: string): Promise<void> {
    return skills.deleteSkillFile(this.transport, slug, fileName);
  }
}
